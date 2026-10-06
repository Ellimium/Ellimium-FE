"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import { Asset } from "./asset-images";
import { releaseSharedImages, sharedImageUrls } from "./shared-images";

type SharedAsset = Asset & { owner_id: string };

function RoomAssets({ roomId }: { roomId: string }) {
  const [assets, setAssets] = useState<SharedAsset[]>([]);
  const [images, setImages] = useState(new Map<string, string>());
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let urls = new Map<string, string>();
    async function load() {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) throw new Error("authentication required");
        const shares = await supabase.from("room_asset_shares").select("asset_id")
          .eq("room_id", roomId).abortSignal(controller.signal);
        if (shares.error) throw shares.error;
        const ids = shares.data.map(({ asset_id }) => asset_id);
        const result = ids.length ? await supabase.from("assets")
          .select("id, owner_id, category, storage_path, thumbnail_storage_path, created_at")
          .in("id", ids).order("created_at", { ascending: false }).abortSignal(controller.signal)
          : { data: [], error: null };
        if (result.error) throw result.error;
        urls = await sharedImageUrls(result.data.flatMap((asset) =>
          [asset.thumbnail_storage_path ?? asset.storage_path, ...(asset.category === "map" ? [asset.storage_path] : [])]),
        session.access_token, controller.signal);
        if (controller.signal.aborted) { releaseSharedImages(urls); return; }
        setUserId(session.user.id);
        setAssets(result.data);
        setImages(urls);
      } catch {
        if (!controller.signal.aborted) setError("룸 공용 자산을 불러올 수 없습니다. 참여 상태를 확인하고 다시 조회하세요.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => { controller.abort(); releaseSharedImages(urls); };
  }, [roomId]);

  if (loading) return <p className="muted" role="status">룸 공용 자산을 불러오는 중…</p>;
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!assets.length) return <p className="muted">이 룸에 공유된 자산이 없습니다.</p>;
  return <div className="asset-grid">
    {assets.map((asset) => <article className="asset-card" key={asset.id}>
      <div className="asset-thumbnail"><img
        src={images.get(asset.thumbnail_storage_path ?? asset.storage_path)}
        alt={`${asset.category} 공용 자산`}
      /></div>
      <div><strong>{asset.category === "map" ? "맵" : asset.category === "token" ? "토큰" : asset.category === "item" ? "아이템" : "기타"}</strong>
        <small>룸 공용 · {asset.owner_id === userId ? "내 자산" : "다른 구성원의 자산"}</small></div>
      {asset.category === "map" && <img className="asset-map-result" src={images.get(asset.storage_path)} alt="공유된 맵" />}
    </article>)}
  </div>;
}

export default function SharedAssets({ revision = 0 }: { revision?: number }) {
  const [rooms, setRooms] = useState<{ id: string; name: string }[] | null>(null);
  const [roomId, setRoomId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const selectedRoomId = rooms?.some((room) => room.id === roomId) ? roomId : "";

  useEffect(() => {
    const controller = new AbortController();
    setRooms(null);
    setError("");
    supabase.from("rooms").select("id, name").order("created_at", { ascending: false })
      .abortSignal(controller.signal).then(({ data, error: queryError }) => {
        if (controller.signal.aborted) return;
        if (queryError) setError("참여 중인 룸 목록을 불러올 수 없습니다. 다시 조회하세요.");
        else { setRooms(data); setError(""); }
      });
    return () => controller.abort();
  }, [refresh, revision]);

  return <section className="asset-library" aria-labelledby="shared-assets-title" aria-busy={!rooms && !error}>
    <div className="asset-library-heading"><div><p className="eyebrow">ROOM ASSETS</p><h2 id="shared-assets-title">룸 공용 자산</h2></div></div>
    <label className="asset-folder-filter">공용 자산을 볼 룸<select value={selectedRoomId} disabled={!rooms} onChange={(event) => setRoomId(event.target.value)}>
      <option value="">룸을 선택하세요</option>
      {rooms?.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
    </select></label>
    <button className="secondary-button asset-refresh" type="button" onClick={() => {
      setRooms(null); setError(""); setRefresh((value) => value + 1);
    }}>공용 자산 새로고침</button>
    {error ? <p className="form-error" role="alert">{error}</p>
      : !rooms ? <p className="muted" role="status">참여 중인 룸을 불러오는 중…</p>
      : !rooms.length ? <p className="muted">참여 중인 룸이 없습니다.</p>
      : selectedRoomId ? <RoomAssets key={`${selectedRoomId}:${refresh}:${revision}`} roomId={selectedRoomId} />
      : <p className="muted">참여 중인 룸을 선택하면 공유된 자산을 볼 수 있습니다.</p>}
  </section>;
}
