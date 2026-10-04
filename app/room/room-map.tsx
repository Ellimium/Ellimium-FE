"use client";

import { FormEvent, KeyboardEvent, PointerEvent, useEffect, useRef, useState } from "react";

import { assetImagePaths, type Asset } from "../assets/asset-images";
import { supabase } from "@/lib/supabase/client";
import MapDrawingShape from "./map-drawing-shape";
import {
  canEditMapDrawing,
  createDrawingDraft,
  DRAWING_TYPES,
  drawingPointFromClient,
  type DrawingPoint,
  type DrawingType,
  type MapDrawing,
} from "./map-drawing";
import { hideArea, rectangleFromPoints, type VisibilityArea } from "./map-visibility";
import { useRoomPermissions } from "./room-permissions";
import { gridCoordinate, mapPointFromClient } from "./token-position";

type Role = "master" | "player" | "spectator";
type RoomMapRow = {
  id: string;
  asset_id: string;
  grid_cell_size: number | null;
  grid_offset_x: number | null;
  grid_offset_y: number | null;
  fog_enabled: boolean;
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
type VisibilityRow = {
  id: string;
  map_id: string;
  room_member_id: string | null;
  scope: "all" | "member";
  inherits_common: boolean;
  revealed_areas: VisibilityArea[];
};
type FogDrag = { pointerId: number; start: { x: number; y: number }; current: { x: number; y: number } };
type DrawingDrag = { pointerId: number; points: DrawingPoint[] };

const DRAWING_LABELS: Record<DrawingType, string> = {
  line: "선",
  circle: "원",
  rectangle: "사각형",
  freehand: "브러시",
  text: "텍스트",
};

export default function RoomMap({ roomId }: { roomId?: string }) {
  const { canUse, loading: permissionLoading } = useRoomPermissions();
  const canViewMap = !permissionLoading && canUse("map_view");
  const canMoveTokens = canViewMap && canUse("token_move");
  const [maps, setMaps] = useState<DisplayMap[]>([]);
  const [tokens, setTokens] = useState<DisplayToken[]>([]);
  const [tokenAssets, setTokenAssets] = useState<TokenAsset[]>([]);
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const canDraw = canEditMapDrawing(canViewMap, canUse("drawing"), role);
  const [selectedId, setSelectedId] = useState("");
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(Boolean(roomId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [visibilityRows, setVisibilityRows] = useState<VisibilityRow[]>([]);
  const [visibilityTarget, setVisibilityTarget] = useState("all");
  const [fogMode, setFogMode] = useState<"reveal" | "hide">("reveal");
  const [fogDragging, setFogDragging] = useState<FogDrag | null>(null);
  const [fogEditing, setFogEditing] = useState(false);
  const [fogBusy, setFogBusy] = useState(false);
  const [drawings, setDrawings] = useState<MapDrawing[]>([]);
  const [drawingType, setDrawingType] = useState<DrawingType>("freehand");
  const [drawingColor, setDrawingColor] = useState("#E0B45B");
  const [drawingStrokeWidth, setDrawingStrokeWidth] = useState(4);
  const [drawingText, setDrawingText] = useState("");
  const [drawingEditing, setDrawingEditing] = useState(false);
  const [drawingDrag, setDrawingDrag] = useState<DrawingDrag | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState("");
  const [drawingBusy, setDrawingBusy] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    let active = true;

    if (!roomId || permissionLoading) {
      if (!roomId) setLoading(false);
      return;
    }

    if (!canViewMap) {
      setMaps([]);
      setTokens([]);
      setTokenAssets([]);
      setVisibilityRows([]);
      setDrawings([]);
      setSelectedId("");
      setMapSize(null);
      setDragging(null);
      setLoading(false);
      setError("");
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
        supabase.from("room_maps").select("id, asset_id, grid_cell_size, grid_offset_x, grid_offset_y, fog_enabled").eq("room_id", roomId).order("created_at"),
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

      const [{ data: profiles, error: profileError }, { data: ownedTokenAssets, error: tokenAssetError }, { data: roomTokens, error: tokenError }, { data: mapVisibility, error: visibilityError }] = await Promise.all([
        playerIds.length
          ? supabase.from("profiles").select("user_id, nickname").in("user_id", playerIds)
          : Promise.resolve({ data: [], error: null }),
        currentRole === "master"
          ? supabase.from("assets").select("id, storage_path").eq("category", "token").eq("owner_id", user.id).order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        mapList.length
          ? supabase.from("room_tokens").select("id, map_id, owner_id, image_asset_id, name, x, y, size").in("map_id", mapList.map((map) => map.id)).order("created_at")
          : Promise.resolve({ data: [], error: null }),
        mapList.length
          ? supabase.from("map_visibility").select("id, map_id, room_member_id, scope, inherits_common, revealed_areas").in("map_id", mapList.map((map) => map.id))
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (!active) return;
      if (profileError || tokenAssetError || tokenError || visibilityError) {
        setError("토큰과 시야 정보를 불러올 수 없습니다.");
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
      setVisibilityRows((mapVisibility ?? []) as VisibilityRow[]);
      setMaps(nextMaps);
      setSelectedId((current) => nextMaps.some((map) => map.id === current) ? current : nextMaps[0]?.id ?? "");
      setLoading(false);
    }

    function refresh(event: Event) {
      if ((event as CustomEvent<string>).detail === roomId) void load();
    }

    window.addEventListener("room-map-registered", refresh);
    void load();
    return () => {
      active = false;
      window.removeEventListener("room-map-registered", refresh);
    };
  }, [canViewMap, permissionLoading, roomId]);

  useEffect(() => { setMapSize(null); }, [selectedId]);

  useEffect(() => {
    setSelectedDrawingId("");
    setDrawingDrag(null);
  }, [selectedId]);

  useEffect(() => {
    if (visibilityTarget !== "all" && !players.some((player) => player.userId === visibilityTarget)) setVisibilityTarget("all");
  }, [players, visibilityTarget]);

  useEffect(() => {
    if (!roomId || !canViewMap || !maps.length) return;

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
  }, [canViewMap, maps, roomId]);

  useEffect(() => {
    if (!roomId || !canViewMap || !maps.length) {
      setDrawings([]);
      return;
    }

    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const mapIds = maps.map((map) => map.id);

    async function refreshDrawings() {
      const { data, error: drawingError } = await supabase
        .from("room_map_drawings")
        .select("id, map_id, drawing_type, geometry, text_content, color, stroke_width, created_at, updated_at")
        .in("map_id", mapIds)
        .order("created_at");
      if (!active) return;
      if (drawingError) {
        setError("맵 그림을 불러올 수 없습니다.");
        return;
      }
      setDrawings((data ?? []) as MapDrawing[]);
    }

    async function subscribe() {
      try {
        await supabase.realtime.setAuth();
        if (!active) return;
        channel = supabase.channel(`room:${roomId}:drawings`, { config: { private: true } });
        for (const event of ["INSERT", "UPDATE", "DELETE"] as const) {
          channel.on("broadcast", { event }, () => { void refreshDrawings(); });
        }
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") void refreshDrawings();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setError("그리기 실시간 채널에 연결할 수 없습니다.");
        });
      } catch {
        if (active) setError("그리기 실시간 채널에 연결할 수 없습니다.");
      }
    }

    void refreshDrawings();
    void subscribe();
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [canViewMap, maps, roomId]);

  useEffect(() => {
    if (!canViewMap || !selectedId) return;
    const channel = supabase
      .channel(`map-visibility:${selectedId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "map_visibility", filter: `map_id=eq.${selectedId}` }, ({ new: next }) => {
        const row = next as VisibilityRow;
        if (!row.id) return;
        setVisibilityRows((current) => [...current.filter(({ id }) => id !== row.id), row]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "room_maps", filter: `id=eq.${selectedId}` }, ({ new: next }) => {
        if (typeof next.fog_enabled !== "boolean") return;
        setMaps((current) => current.map((map) => map.id === selectedId ? { ...map, fog_enabled: next.fog_enabled as boolean } : map));
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") setError("맵 시야 실시간 채널에 연결할 수 없습니다.");
      });

    return () => { void supabase.removeChannel(channel); };
  }, [canViewMap, selectedId]);

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
    if (!canMoveTokens || !mapSize) return;
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
    if (!canMoveTokens || !dragging || event.pointerId !== dragging.pointerId) return;
    const position = dragPosition(event.clientX, event.clientY, event.currentTarget, dragging);
    if (!position) return;

    setTokens((current) => current.map((token) => token.id === dragging.tokenId ? { ...token, ...position } : token));
    broadcastPosition(dragging.tokenId, position.x, position.y);
  }

  async function persistPosition(tokenId: string, x: number, y: number, startX: number, startY: number) {
    if (!canMoveTokens) return;
    setError("");
    try {
      const { data, error: updateError } = await supabase
        .from("room_tokens")
        .update({ x, y })
        .eq("id", tokenId)
        .select("id")
        .maybeSingle();
      if (!updateError && data) return;
    } catch {
      // 아래에서 확정 좌표로 복구하고 같은 오류를 표시한다.
    }

    setTokens((current) => current.map((token) => token.id === tokenId ? { ...token, x: startX, y: startY } : token));
    broadcastPosition(tokenId, startX, startY);
    setError("토큰의 최종 위치를 저장할 수 없습니다.");
  }

  function finishDrag(event: PointerEvent<SVGSVGElement>) {
    if (!canMoveTokens || !dragging || event.pointerId !== dragging.pointerId) return;
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
    if (!canMoveTokens) return;
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
    try {
      const { data, error: insertError } = await supabase.from("room_tokens").insert({
        map_id: selectedId,
        name: String(form.get("name") ?? "").trim(),
        image_asset_id: imageAssetId || null,
        owner_id: ownerId || null,
        x: Number(form.get("x")),
        y: Number(form.get("y")),
        size: Number(form.get("size")),
      }).select("id, map_id, owner_id, image_asset_id, name, x, y, size").single();

      if (insertError || !data) {
        setError("토큰을 만들 수 없습니다. 이름, 이미지와 소유자를 확인하세요.");
        return;
      }

      const asset = tokenAssets.find(({ id }) => id === imageAssetId);
      const { data: signedImage } = asset
        ? await supabase.storage.from("assets").createSignedUrl(asset.storage_path, 60 * 60)
        : { data: null };
      setTokens((current) => [...current, { ...(data as RoomTokenRow), imageUrl: signedImage?.signedUrl }]);
      formElement.reset();
      setMessage("토큰을 배치했습니다.");
    } catch {
      setError("토큰 서버에 연결하지 못했습니다. 저장 여부를 확인한 뒤 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  }

  async function setFogEnabled(enabled: boolean) {
    if (!selected || role !== "master") return;
    setFogBusy(true);
    setError("");
    const { error: fogError } = await supabase.rpc("set_map_fog_enabled", {
      target_map_id: selected.id,
      new_fog_enabled: enabled,
    });
    if (fogError) setError("Fog 상태를 변경할 수 없습니다.");
    else setMaps((current) => current.map((map) => map.id === selected.id ? { ...map, fog_enabled: enabled } : map));
    setFogBusy(false);
  }

  function targetRow(mapId: string, target: string) {
    return visibilityRows.find((row) => row.map_id === mapId && (target === "all" ? row.scope === "all" : row.room_member_id === target));
  }

  function visibleAreas(mapId: string, target: string) {
    const common = targetRow(mapId, "all")?.revealed_areas ?? [];
    if (target === "all") return common;
    const personal = targetRow(mapId, target);
    return !personal || personal.inherits_common ? common : personal.revealed_areas;
  }

  async function saveVisibility(areas: VisibilityArea[]) {
    if (!selected || role !== "master") return;
    setFogBusy(true);
    setError("");
    const existing = targetRow(selected.id, visibilityTarget);
    const query = existing
      ? supabase.from("map_visibility").update({ revealed_areas: areas, inherits_common: false }).eq("id", existing.id)
      : supabase.from("map_visibility").insert({
        map_id: selected.id,
        room_member_id: visibilityTarget === "all" ? null : visibilityTarget,
        scope: visibilityTarget === "all" ? "all" : "member",
        revealed_areas: areas,
      });
    const { data, error: visibilityError } = await query
      .select("id, map_id, room_member_id, scope, inherits_common, revealed_areas")
      .single();
    if (visibilityError || !data) setError("맵 시야 영역을 저장할 수 없습니다.");
    else setVisibilityRows((current) => [...current.filter(({ id }) => id !== data.id), data as VisibilityRow]);
    setFogBusy(false);
  }

  async function restoreCommonVisibility() {
    if (!selected || visibilityTarget === "all") return;
    const existing = targetRow(selected.id, visibilityTarget);
    if (!existing) return;
    setFogBusy(true);
    setError("");
    const { data, error: visibilityError } = await supabase.from("map_visibility")
      .update({ inherits_common: true })
      .eq("id", existing.id)
      .select("id, map_id, room_member_id, scope, inherits_common, revealed_areas")
      .single();
    if (visibilityError || !data) setError("플레이어 시야를 공통 영역으로 되돌릴 수 없습니다.");
    else setVisibilityRows((current) => [...current.filter(({ id }) => id !== data.id), data as VisibilityRow]);
    setFogBusy(false);
  }

  function fogPoint(event: PointerEvent<SVGRectElement>) {
    if (!mapSize) return null;
    const svg = event.currentTarget.ownerSVGElement;
    return svg ? mapPointFromClient(event.clientX, event.clientY, svg.getBoundingClientRect(), mapSize) : null;
  }

  function startFogDrag(event: PointerEvent<SVGRectElement>) {
    const point = fogPoint(event);
    if (!point || fogBusy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setFogDragging({ pointerId: event.pointerId, start: point, current: point });
  }

  function moveFogDrag(event: PointerEvent<SVGRectElement>) {
    if (!fogDragging || event.pointerId !== fogDragging.pointerId) return;
    const point = fogPoint(event);
    if (point) setFogDragging((current) => current ? { ...current, current: point } : null);
  }

  function finishFogDrag(event: PointerEvent<SVGRectElement>) {
    if (!selected || !mapSize || !fogDragging || event.pointerId !== fogDragging.pointerId) return;
    const area = rectangleFromPoints(fogDragging.start, fogPoint(event) ?? fogDragging.current, mapSize);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setFogDragging(null);
    if (!area) return;
    const current = visibleAreas(selected.id, visibilityTarget);
    void saveVisibility(fogMode === "reveal" ? [...current, area] : hideArea(current, area));
  }

  function drawingPoint(event: PointerEvent<SVGRectElement>) {
    if (!mapSize) return null;
    const svg = event.currentTarget.ownerSVGElement;
    return svg ? drawingPointFromClient(event.clientX, event.clientY, svg.getBoundingClientRect(), mapSize) : null;
  }

  async function createDrawing(points: DrawingPoint[]) {
    if (!selected || !canDraw) return;
    const draft = createDrawingDraft(
      drawingType,
      points,
      { color: drawingColor, strokeWidth: drawingStrokeWidth },
      drawingText,
    );
    if (!draft) {
      setError(drawingType === "text" ? "텍스트를 입력한 뒤 맵을 선택하세요." : "그리려는 영역을 조금 더 크게 지정하세요.");
      return;
    }

    setDrawingBusy(true);
    setError("");
    try {
      const { data, error: insertError } = await supabase
        .from("room_map_drawings")
        .insert({ map_id: selected.id, ...draft })
        .select("id, map_id, drawing_type, geometry, text_content, color, stroke_width, created_at, updated_at")
        .single();
      if (insertError || !data) setError("그림을 저장할 수 없습니다.");
      else {
        setDrawings((current) => [...current.filter(({ id }) => id !== data.id), data as MapDrawing]);
        setSelectedDrawingId(data.id);
        if (drawingType === "text") setDrawingText("");
      }
    } catch {
      setError("그림 서버에 연결할 수 없습니다.");
    } finally {
      setDrawingBusy(false);
    }
  }

  function startDrawing(event: PointerEvent<SVGRectElement>) {
    if (!canDraw || drawingBusy) return;
    const point = drawingPoint(event);
    if (!point) return;
    if (drawingType === "text") {
      void createDrawing([point]);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawingDrag({ pointerId: event.pointerId, points: [point] });
    setSelectedDrawingId("");
  }

  function moveDrawing(event: PointerEvent<SVGRectElement>) {
    if (!drawingDrag || event.pointerId !== drawingDrag.pointerId) return;
    const point = drawingPoint(event);
    if (!point) return;
    setDrawingDrag((current) => current ? {
      ...current,
      points: drawingType === "freehand" ? [...current.points, point] : [current.points[0], point],
    } : null);
  }

  function finishDrawing(event: PointerEvent<SVGRectElement>) {
    if (!drawingDrag || event.pointerId !== drawingDrag.pointerId) return;
    const point = drawingPoint(event);
    const points = point
      ? drawingType === "freehand" ? [...drawingDrag.points, point] : [drawingDrag.points[0], point]
      : drawingDrag.points;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDrawingDrag(null);
    void createDrawing(points);
  }

  async function updateSelectedDrawing() {
    if (!canDraw || !selectedDrawingId) return;
    setDrawingBusy(true);
    setError("");
    try {
      const { data, error: updateError } = await supabase
        .from("room_map_drawings")
        .update({ color: drawingColor, stroke_width: drawingStrokeWidth })
        .eq("id", selectedDrawingId)
        .select("id, map_id, drawing_type, geometry, text_content, color, stroke_width, created_at, updated_at")
        .single();
      if (updateError || !data) setError("그림 스타일을 변경할 수 없습니다.");
      else setDrawings((current) => current.map((drawing) => drawing.id === data.id ? data as MapDrawing : drawing));
    } catch {
      setError("그림 서버에 연결할 수 없습니다.");
    } finally {
      setDrawingBusy(false);
    }
  }

  async function deleteSelectedDrawing() {
    if (!canDraw || !selectedDrawingId) return;
    setDrawingBusy(true);
    setError("");
    try {
      const { error: deleteError } = await supabase.from("room_map_drawings").delete().eq("id", selectedDrawingId);
      if (deleteError) setError("그림을 삭제할 수 없습니다.");
      else {
        setDrawings((current) => current.filter(({ id }) => id !== selectedDrawingId));
        setSelectedDrawingId("");
      }
    } catch {
      setError("그림 서버에 연결할 수 없습니다.");
    } finally {
      setDrawingBusy(false);
    }
  }

  const selected = maps.find((map) => map.id === selectedId);
  const selectedTokens = tokens.filter((token) => token.map_id === selectedId);
  const selectedDrawings = drawings.filter((drawing) => drawing.map_id === selectedId);
  // ponytail: 그리드 미설정 맵은 50px 셀로 표시하며 자유 배치가 필요해지면 픽셀 좌표 모드를 분리한다.
  const cellSize = selected?.grid_cell_size ?? 50;
  const offsetX = selected?.grid_offset_x ?? 0;
  const offsetY = selected?.grid_offset_y ?? 0;
  const permissionText = !canViewMap
    ? "맵 보기 권한 없음"
    : !canMoveTokens
      ? "토큰 이동 불가"
      : role === "master" ? "모든 토큰 조작" : "내 토큰 조작";
  const audience = role === "master" ? visibilityTarget : role === "player" ? currentUserId : "all";
  const revealedAreas = selected ? visibleAreas(selected.id, audience) : [];
  const previewArea = fogDragging && mapSize ? rectangleFromPoints(fogDragging.start, fogDragging.current, mapSize) : null;
  const drawingPreview = drawingDrag
    ? createDrawingDraft(drawingType, drawingDrag.points, { color: drawingColor, strokeWidth: drawingStrokeWidth }, drawingText)
    : null;
  const maskId = selected ? `fog-visible-${selected.id}` : "fog-visible";
  const overlayMaskId = selected ? `fog-overlay-${selected.id}` : "fog-overlay";

  return <>
    <div className="battle-map" aria-busy={loading}>
      {!permissionLoading && !canViewMap && <p className="map-notice">맵 보기 권한이 없습니다.</p>}
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
        <defs>
          <mask id={maskId}><rect width={mapSize.width} height={mapSize.height} fill="black" />{revealedAreas.map((area, index) => <rect key={index} {...area} fill="white" />)}</mask>
          <mask id={overlayMaskId}><rect width={mapSize.width} height={mapSize.height} fill="white" />{revealedAreas.map((area, index) => <rect key={index} {...area} fill="black" />)}</mask>
        </defs>
        <g mask={selected.fog_enabled && role !== "master" ? `url(#${maskId})` : undefined}>
          <image href={selected.mapUrl} width={mapSize.width} height={mapSize.height} />
          {selectedDrawings.map((drawing) => <MapDrawingShape
            key={drawing.id}
            drawing={drawing}
            selected={drawing.id === selectedDrawingId}
          />)}
          {selectedTokens.map((token) => {
          const tokenSize = Number(token.size) * cellSize;
          const x = offsetX + Number(token.x) * cellSize;
          const y = offsetY + Number(token.y) * cellSize;
          const controllable = canMoveTokens && (role === "master" || (role === "player" && token.owner_id === currentUserId));
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
        </g>
        {drawingEditing && canDraw && !fogEditing && <rect
          className="drawing-interaction"
          width={mapSize.width}
          height={mapSize.height}
          onPointerDown={startDrawing}
          onPointerMove={moveDrawing}
          onPointerUp={finishDrawing}
          onPointerCancel={() => setDrawingDrag(null)}
        />}
        {drawingPreview && <MapDrawingShape drawing={drawingPreview} />}
        {selected.fog_enabled && role === "master" && <rect className="fog-overlay" width={mapSize.width} height={mapSize.height} mask={`url(#${overlayMaskId})`} />}
        {selected.fog_enabled && role === "master" && fogEditing && <rect
          className="fog-interaction"
          width={mapSize.width}
          height={mapSize.height}
          onPointerDown={startFogDrag}
          onPointerMove={moveFogDrag}
          onPointerUp={finishFogDrag}
          onPointerCancel={() => setFogDragging(null)}
        />}
        {previewArea && <rect className={`fog-preview fog-preview-${fogMode}`} {...previewArea} />}
      </svg>}
      {selected && <span className="token-permission">{permissionText}</span>}
      {selected && canDraw && <details className="drawing-controls" onToggle={(event) => {
        setDrawingEditing(event.currentTarget.open);
        if (!event.currentTarget.open) setDrawingDrag(null);
      }}>
        <summary>그리기</summary>
        <div aria-busy={drawingBusy}>
          <fieldset><legend>도구</legend>{DRAWING_TYPES.map((type) => <button
            key={type}
            type="button"
            className={drawingType === type ? "drawing-tool-active" : ""}
            aria-pressed={drawingType === type}
            disabled={drawingBusy}
            onClick={() => setDrawingType(type)}
          >{DRAWING_LABELS[type]}</button>)}</fieldset>
          {drawingType === "text" && <label>내용<input
            value={drawingText}
            maxLength={500}
            disabled={drawingBusy}
            onChange={(event) => setDrawingText(event.target.value)}
            placeholder="맵에 표시할 텍스트"
          /></label>}
          <div className="drawing-style-controls">
            <label>색상<input aria-label="그리기 색상" type="color" value={drawingColor} disabled={drawingBusy} onChange={(event) => setDrawingColor(event.target.value.toUpperCase())} /></label>
            <label>두께 {drawingStrokeWidth}<input aria-label="선 두께" type="range" min="1" max="20" value={drawingStrokeWidth} disabled={drawingBusy} onChange={(event) => setDrawingStrokeWidth(Number(event.target.value))} /></label>
          </div>
          <label>기존 그림<select value={selectedDrawingId} disabled={drawingBusy || !selectedDrawings.length} onChange={(event) => {
            const drawing = selectedDrawings.find(({ id }) => id === event.target.value);
            setSelectedDrawingId(event.target.value);
            if (drawing) {
              setDrawingColor(drawing.color);
              setDrawingStrokeWidth(Number(drawing.stroke_width));
            }
          }}><option value="">선택 안 함</option>{selectedDrawings.map((drawing, index) => <option key={drawing.id} value={drawing.id}>그림 {index + 1} · {DRAWING_LABELS[drawing.drawing_type]}</option>)}</select></label>
          <div className="drawing-actions">
            <button type="button" disabled={drawingBusy || !selectedDrawingId} onClick={() => void updateSelectedDrawing()}>스타일 적용</button>
            <button className="drawing-delete" type="button" disabled={drawingBusy || !selectedDrawingId} onClick={() => void deleteSelectedDrawing()}>삭제</button>
          </div>
          <small>{fogEditing ? "시야 편집을 닫아야 그릴 수 있습니다." : drawingType === "text" ? "내용을 입력하고 맵을 클릭하세요." : "맵을 드래그해 그리세요."}</small>
        </div>
      </details>}
      {selected && role === "master" && <details className="fog-controls" onToggle={(event) => setFogEditing(event.currentTarget.open)}>
        <summary>Fog of War</summary>
        <div aria-busy={fogBusy}>
          <button type="button" disabled={fogBusy} onClick={() => void setFogEnabled(!selected.fog_enabled)}>{selected.fog_enabled ? "Fog 끄기" : "Fog 켜기"}</button>
          <label>대상<select value={visibilityTarget} disabled={fogBusy} onChange={(event) => setVisibilityTarget(event.target.value)}><option value="all">전체 플레이어</option>{players.map((player) => <option key={player.userId} value={player.userId}>{player.nickname}</option>)}</select></label>
          <fieldset><legend>드래그 동작</legend><label><input type="radio" name="fogMode" checked={fogMode === "reveal"} onChange={() => setFogMode("reveal")} />공개</label><label><input type="radio" name="fogMode" checked={fogMode === "hide"} onChange={() => setFogMode("hide")} />가리기</label></fieldset>
          {visibilityTarget !== "all" && <button type="button" disabled={fogBusy || !targetRow(selected.id, visibilityTarget) || targetRow(selected.id, visibilityTarget)?.inherits_common} onClick={() => void restoreCommonVisibility()}>공통 시야 사용</button>}
          <small>{selected.fog_enabled ? "맵을 드래그해 영역을 변경하세요." : "영역을 편집하려면 Fog를 켜세요."}</small>
        </div>
      </details>}
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
