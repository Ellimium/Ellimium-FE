"use client";

import { FormEvent, KeyboardEvent, PointerEvent, useEffect, useRef, useState } from "react";

import { assetImagePaths, type Asset } from "../assets/asset-images";
import { supabase } from "@/lib/supabase/client";
import { gridCoordinate, mapPointFromClient } from "./token-position";

type Role = "master" | "player" | "spectator";
type RoomMapRow = {
  id: string;
  asset_id: string;
  grid_cell_size: number | null;
  grid_offset_x: number | null;
  grid_offset_y: number | null;
};
type RoomTokenRow = {
  id: string;
  map_id: string;
  owner_id: string | null;
  image_asset_id: string | null;
  name: string;
  x: number;
  y: number;
  size: number;
};
type DisplayMap = RoomMapRow & { mapUrl: string; thumbnailUrl?: string };
type DisplayToken = RoomTokenRow & { imageUrl?: string };
type TokenAsset = Pick<Asset, "id" | "storage_path">;
type PlayerOption = { userId: string; nickname: string };
type DragState = { tokenId: string; pointerId: number; offsetX: number; offsetY: number; startX: number; startY: number };

export default function RoomMap({ roomId }: { roomId?: string }) {
  const [maps, setMaps] = useState<DisplayMap[]>([]);
  const [tokens, setTokens] = useState<DisplayToken[]>([]);
  const [tokenAssets, setTokenAssets] = useState<TokenAsset[]>([]);
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(Boolean(roomId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState<DragState | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    let active = true;

    if (!roomId) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError("");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) {
        if (active) setLoading(false);
        return;
      }

      const [{ data: roomMaps, error: roomMapError }, { data: members, error: memberError }] = await Promise.all([
        supabase.from("room_maps").select("id, asset_id, grid_cell_size, grid_offset_x, grid_offset_y").eq("room_id", roomId).order("created_at"),
        supabase.from("room_members").select("user_id, role").eq("room_id", roomId).eq("status", "active"),
      ]);

      if (!active) return;
      if (roomMapError || memberError) {
        setError("룸 맵과 토큰 권한을 불러올 수 없습니다.");
        setLoading(false);
        return;
      }

      const memberList = (members ?? []) as { user_id: string; role: Role }[];
      const currentRole = memberList.find((member) => member.user_id === user.id)?.role ?? null;
      const playerIds = memberList.filter((member) => member.role === "player").map((member) => member.user_id);
      const mapList = (roomMaps ?? []) as RoomMapRow[];

      const [{ data: profiles, error: profileError }, { data: ownedTokenAssets, error: tokenAssetError }, { data: roomTokens, error: tokenError }] = await Promise.all([
        playerIds.length
          ? supabase.from("profiles").select("user_id, nickname").in("user_id", playerIds)
          : Promise.resolve({ data: [], error: null }),
        currentRole === "master"
          ? supabase.from("assets").select("id, storage_path").eq("category", "token").eq("owner_id", user.id).order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        mapList.length
          ? supabase.from("room_tokens").select("id, map_id, owner_id, image_asset_id, name, x, y, size").in("map_id", mapList.map((map) => map.id)).order("created_at")
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (!active) return;
      if (profileError || tokenAssetError || tokenError) {
        setError("토큰 정보를 불러올 수 없습니다.");
        setLoading(false);
        return;
      }

      const tokenList = (roomTokens ?? []) as RoomTokenRow[];
      const assetIds = [...new Set([
        ...mapList.map((map) => map.asset_id),
        ...tokenList.flatMap((token) => token.image_asset_id ? [token.image_asset_id] : []),
      ])];
      const { data: assets, error: assetError } = assetIds.length
        ? await supabase.from("assets").select("id, category, storage_path, thumbnail_storage_path, created_at").in("id", assetIds)
        : { data: [], error: null };

      if (!active) return;
      if (assetError) {
        setError("룸 맵과 토큰 이미지를 불러올 수 없습니다.");
        setLoading(false);
        return;
      }

      const assetList = (assets ?? []) as Asset[];
      const imagePaths = [...new Set([
        ...assetImagePaths(assetList),
        ...assetList.filter((asset) => asset.category === "token").map((asset) => asset.storage_path),
      ])];
      const { data: signedUrls, error: signedUrlError } = imagePaths.length
        ? await supabase.storage.from("assets").createSignedUrls(imagePaths, 60 * 60)
        : { data: [], error: null };

      if (!active) return;
      if (signedUrlError) {
        setError("룸 맵과 토큰 이미지를 표시할 수 없습니다.");
        setLoading(false);
        return;
      }

      const urls = new Map(signedUrls.map(({ path, signedUrl }) => [path, signedUrl]));
      const assetsById = new Map(assetList.map((asset) => [asset.id, asset]));
      const nextMaps = mapList.flatMap((map) => {
        const asset = assetsById.get(map.asset_id);
        const mapUrl = asset && urls.get(asset.storage_path);
        return asset && mapUrl ? [{ ...map, mapUrl, thumbnailUrl: asset.thumbnail_storage_path ? urls.get(asset.thumbnail_storage_path) ?? undefined : undefined }] : [];
      });

      setCurrentUserId(user.id);
      setRole(currentRole);
      setPlayers(playerIds.map((userId) => ({
        userId,
        nickname: profiles?.find((profile) => profile.user_id === userId)?.nickname ?? userId,
      })));
      setTokenAssets((ownedTokenAssets ?? []) as TokenAsset[]);
      setTokens(tokenList.map((token) => {
        const asset = token.image_asset_id ? assetsById.get(token.image_asset_id) : undefined;
        return { ...token, imageUrl: asset ? urls.get(asset.storage_path) ?? undefined : undefined };
      }));
      setMaps(nextMaps);
      setSelectedId((current) => nextMaps.some((map) => map.id === current) ? current : nextMaps[0]?.id ?? "");
      setLoading(false);
    }

    void load();
    return () => { active = false; };
  }, [roomId]);

  useEffect(() => { setMapSize(null); }, [selectedId]);

  useEffect(() => {
    if (!roomId || !maps.length) return;

    let active = true;
    const mapIds = maps.map((map) => map.id);
    const channel = supabase.channel(`room:${roomId}:tokens`, { config: { private: true, broadcast: { self: false } } });
    channelRef.current = channel;

    async function refreshPositions() {
      const { data, error: positionError } = await supabase.from("room_tokens").select("id, x, y").in("map_id", mapIds);
      if (!active) return;
      if (positionError) {
        setError("토큰의 확정 위치를 다시 불러올 수 없습니다.");
        return;
      }

      const positions = new Map((data ?? []).map((token) => [token.id, token]));
      setTokens((current) => current.map((token) => {
        const position = positions.get(token.id);
        return position ? { ...token, x: Number(position.x), y: Number(position.y) } : token;
      }));
    }

    channel
      .on("broadcast", { event: "token-move" }, ({ payload }) => {
        const tokenId = typeof payload?.token_id === "string" ? payload.token_id : "";
        const x = Number(payload?.x);
        const y = Number(payload?.y);
        if (!tokenId || !Number.isFinite(x) || !Number.isFinite(y)) return;
        setTokens((current) => current.map((token) => token.id === tokenId ? { ...token, x, y } : token));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "room_tokens" }, ({ new: updated }) => {
        const tokenId = typeof updated.id === "string" ? updated.id : "";
        const x = Number(updated.x);
        const y = Number(updated.y);
        if (!tokenId || !Number.isFinite(x) || !Number.isFinite(y)) return;
        setTokens((current) => current.map((token) => token.id === tokenId ? { ...token, x, y } : token));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refreshPositions();
        if (status === "CHANNEL_ERROR") setError("토큰 실시간 이동 채널에 연결할 수 없습니다.");
      });

    return () => {
      active = false;
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [maps, roomId]);

  function broadcastPosition(tokenId: string, x: number, y: number) {
    void channelRef.current?.send({ type: "broadcast", event: "token-move", payload: { token_id: tokenId, x, y } });
  }

  function dragPosition(clientX: number, clientY: number, svg: SVGSVGElement, drag: DragState) {
    if (!mapSize) return null;
    const point = mapPointFromClient(clientX, clientY, svg.getBoundingClientRect(), mapSize);
    if (!point) return null;
    return {
      x: gridCoordinate(point.x - drag.offsetX, offsetX, cellSize),
      y: gridCoordinate(point.y - drag.offsetY, offsetY, cellSize),
    };
  }

  function startDrag(event: PointerEvent<SVGGElement>, token: DisplayToken) {
    if (!mapSize) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const point = mapPointFromClient(event.clientX, event.clientY, svg.getBoundingClientRect(), mapSize);
    if (!point) return;

    svg.setPointerCapture(event.pointerId);
    setDragging({
      tokenId: token.id,
      pointerId: event.pointerId,
      offsetX: point.x - (offsetX + Number(token.x) * cellSize),
      offsetY: point.y - (offsetY + Number(token.y) * cellSize),
      startX: Number(token.x),
      startY: Number(token.y),
    });
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent<SVGSVGElement>) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const position = dragPosition(event.clientX, event.clientY, event.currentTarget, dragging);
    if (!position) return;

    setTokens((current) => current.map((token) => token.id === dragging.tokenId ? { ...token, ...position } : token));
    broadcastPosition(dragging.tokenId, position.x, position.y);
  }

  async function persistPosition(tokenId: string, x: number, y: number, startX: number, startY: number) {
    setError("");
    const { data, error: updateError } = await supabase
      .from("room_tokens")
      .update({ x, y })
      .eq("id", tokenId)
      .select("id")
      .maybeSingle();

    if (updateError || !data) {
      setTokens((current) => current.map((token) => token.id === tokenId ? { ...token, x: startX, y: startY } : token));
      broadcastPosition(tokenId, startX, startY);
      setError("토큰의 최종 위치를 저장할 수 없습니다.");
    }
  }

  function finishDrag(event: PointerEvent<SVGSVGElement>) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const drag = dragging;
    const position = dragPosition(event.clientX, event.clientY, event.currentTarget, drag);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(null);
    if (!position) return;

    setTokens((current) => current.map((token) => token.id === drag.tokenId ? { ...token, ...position } : token));
    broadcastPosition(drag.tokenId, position.x, position.y);
    void persistPosition(drag.tokenId, position.x, position.y, drag.startX, drag.startY);
  }

  function cancelDrag(event: PointerEvent<SVGSVGElement>) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setTokens((current) => current.map((token) => token.id === dragging.tokenId ? { ...token, x: dragging.startX, y: dragging.startY } : token));
    setDragging(null);
  }

  function moveWithKeyboard(event: KeyboardEvent<SVGGElement>, token: DisplayToken) {
    const movement = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!movement) return;

    event.preventDefault();
    const x = Number(token.x) + movement[0];
    const y = Number(token.y) + movement[1];
    setTokens((current) => current.map((currentToken) => currentToken.id === token.id ? { ...currentToken, x, y } : currentToken));
    broadcastPosition(token.id, x, y);
    void persistPosition(token.id, x, y, Number(token.x), Number(token.y));
  }

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const imageAssetId = String(form.get("imageAssetId") ?? "");
    const ownerId = String(form.get("ownerId") ?? "");

    setBusy(true);
    setError("");
    setMessage("");
    const { data, error: insertError } = await supabase.from("room_tokens").insert({
      map_id: selectedId,
      name: String(form.get("name") ?? "").trim(),
      image_asset_id: imageAssetId || null,
      owner_id: ownerId || null,
      x: Number(form.get("x")),
      y: Number(form.get("y")),
      size: Number(form.get("size")),
    }).select("id, map_id, owner_id, image_asset_id, name, x, y, size").single();

    if (insertError) {
      setError("토큰을 만들 수 없습니다. 이름, 이미지와 소유자를 확인하세요.");
      setBusy(false);
      return;
    }

    const asset = tokenAssets.find(({ id }) => id === imageAssetId);
    const { data: signedImage } = asset
      ? await supabase.storage.from("assets").createSignedUrl(asset.storage_path, 60 * 60)
      : { data: null };
    setTokens((current) => [...current, { ...(data as RoomTokenRow), imageUrl: signedImage?.signedUrl }]);
    formElement.reset();
    setMessage("토큰을 배치했습니다.");
    setBusy(false);
  }

  const selected = maps.find((map) => map.id === selectedId);
  const selectedTokens = tokens.filter((token) => token.map_id === selectedId);
  // ponytail: 그리드 미설정 맵은 50px 셀로 표시하며 자유 배치가 필요해지면 픽셀 좌표 모드를 분리한다.
  const cellSize = selected?.grid_cell_size ?? 50;
  const offsetX = selected?.grid_offset_x ?? 0;
  const offsetY = selected?.grid_offset_y ?? 0;
  const permissionText = role === "master" ? "모든 토큰 조작" : role === "player" ? "내 토큰 조작" : "조회 전용";

  return <>
    <div className="battle-map" aria-busy={loading}>
      {selected && !mapSize && <img
        className="room-map-image"
        src={selected.mapUrl}
        alt="등록된 룸 맵"
        onLoad={(event) => setMapSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      />}
      {selected && mapSize && <svg
        className="room-map-canvas"
        viewBox={`0 0 ${mapSize.width} ${mapSize.height}`}
        aria-label="토큰이 배치된 룸 맵"
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={cancelDrag}
      >
        <image href={selected.mapUrl} width={mapSize.width} height={mapSize.height} />
        {selectedTokens.map((token) => {
          const tokenSize = Number(token.size) * cellSize;
          const x = offsetX + Number(token.x) * cellSize;
          const y = offsetY + Number(token.y) * cellSize;
          const controllable = role === "master" || (role === "player" && token.owner_id === currentUserId);
          const className = `map-token${controllable ? " token-controllable" : ""}${dragging?.tokenId === token.id ? " token-dragging" : ""}`;
          return <g
            className={className}
            key={token.id}
            transform={`translate(${x} ${y})`}
            role={controllable ? "button" : undefined}
            tabIndex={controllable ? 0 : undefined}
            aria-label={`${token.name} 이동, 방향키 사용 가능`}
            onPointerDown={controllable ? (event) => startDrag(event, token) : undefined}
            onKeyDown={controllable ? (event) => moveWithKeyboard(event, token) : undefined}
          >
            <title>{token.name}{controllable ? " · 조작 가능" : " · 조회 전용"}</title>
            {token.imageUrl
              ? <image href={token.imageUrl} width={tokenSize} height={tokenSize} preserveAspectRatio="xMidYMid slice" />
              : <><rect width={tokenSize} height={tokenSize} /><text className="token-initial" x={tokenSize / 2} y={tokenSize / 2}>{token.name.slice(0, 1)}</text></>}
            <rect className="token-outline" width={tokenSize} height={tokenSize} />
            <text className="token-label" x={tokenSize / 2} y={tokenSize + Math.max(14, cellSize * .25)}>{token.name}</text>
          </g>;
        })}
      </svg>}
      {selected && <span className="token-permission">{permissionText}</span>}
      {selected && role === "master" && <details className="token-creator">
        <summary>토큰 추가</summary>
        <form onSubmit={createToken} aria-busy={busy}>
          <label>이름<input name="name" required maxLength={50} disabled={busy} /></label>
          <label>이미지<select name="imageAssetId" defaultValue="" disabled={busy}><option value="">이미지 없음</option>{tokenAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.storage_path.split("/").at(-1)}</option>)}</select></label>
          <label>소유자<select name="ownerId" defaultValue="" disabled={busy}><option value="">미할당</option>{players.map((player) => <option key={player.userId} value={player.userId}>{player.nickname}</option>)}</select></label>
          <div><label>X<input name="x" type="number" step="any" defaultValue="0" required disabled={busy} /></label><label>Y<input name="y" type="number" step="any" defaultValue="0" required disabled={busy} /></label><label>크기<input name="size" type="number" min="0.25" step="0.25" defaultValue="1" required disabled={busy} /></label></div>
          {message && <p className="form-message" role="status">{message}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "배치 중…" : "배치"}</button>
        </form>
      </details>}
      {loading && <p className="map-notice">룸 맵을 불러오는 중…</p>}
      {!loading && error && <p className="map-notice form-error" role="alert">{error}</p>}
      {!loading && !error && !selected && <p className="map-notice">등록된 룸 맵이 없습니다.</p>}
    </div>
    <div className="scene-tabs" aria-label="룸 맵 목록">
      {maps.map((map, index) => <button className={map.id === selectedId ? "scene-active" : ""} type="button" key={map.id} onClick={() => setSelectedId(map.id)}>
        <span className="scene-thumbnail">{map.thumbnailUrl ? <img src={map.thumbnailUrl} alt="" /> : "맵"}</span>맵 {index + 1}
      </button>)}
    </div>
  </>;
}
