"use client";

import { useEffect, useState } from "react";

import { assetImagePaths, type Asset } from "../assets/asset-images";
import { supabase } from "@/lib/supabase/client";

type RoomMapRow = {
  id: string;
  asset_id: string;
  grid_cell_size: number | null;
  grid_offset_x: number | null;
  grid_offset_y: number | null;
};
type DisplayMap = RoomMapRow & { mapUrl: string; thumbnailUrl?: string };

export default function RoomMap({ roomId }: { roomId?: string }) {
  const [maps, setMaps] = useState<DisplayMap[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(Boolean(roomId));
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    if (!roomId) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError("");
      const { data: roomMaps, error: roomMapError } = await supabase
        .from("room_maps")
        .select("id, asset_id, grid_cell_size, grid_offset_x, grid_offset_y")
        .eq("room_id", roomId)
        .order("created_at");

      if (roomMapError || !active) {
        if (active) {
          setError("룸 맵을 불러올 수 없습니다.");
          setLoading(false);
        }
        return;
      }
      if (!roomMaps?.length) {
        setMaps([]);
        setLoading(false);
        return;
      }

      const { data: assets, error: assetError } = await supabase
        .from("assets")
        .select("id, category, storage_path, thumbnail_storage_path, created_at")
        .in("id", roomMaps.map((map) => map.asset_id));

      if (assetError || !active) {
        if (active) {
          setError("룸 맵 파일을 불러올 수 없습니다.");
          setLoading(false);
        }
        return;
      }

      const assetList = (assets ?? []) as Asset[];
      const { data: signedUrls, error: signedUrlError } = await supabase.storage
        .from("assets")
        .createSignedUrls(assetImagePaths(assetList), 60 * 60);

      if (signedUrlError || !active) {
        if (active) {
          setError("룸 맵 파일을 표시할 수 없습니다.");
          setLoading(false);
        }
        return;
      }

      const urls = new Map(signedUrls.map(({ path, signedUrl }) => [path, signedUrl]));
      const assetsById = new Map(assetList.map((asset) => [asset.id, asset]));
      const nextMaps = roomMaps.flatMap((map) => {
        const asset = assetsById.get(map.asset_id);
        const mapUrl = asset && urls.get(asset.storage_path);
        return asset && mapUrl ? [{ ...map, mapUrl, thumbnailUrl: asset.thumbnail_storage_path ? urls.get(asset.thumbnail_storage_path) ?? undefined : undefined }] : [];
      });

      if (active) {
        setMaps(nextMaps);
        setSelectedId((current) => nextMaps.some((map) => map.id === current) ? current : nextMaps[0]?.id ?? "");
        setLoading(false);
      }
    }

    void load();
    return () => { active = false; };
  }, [roomId]);

  const selected = maps.find((map) => map.id === selectedId);

  return <>
    <div className="battle-map" aria-busy={loading}>
      {selected && <img className="room-map-image" src={selected.mapUrl} alt="등록된 룸 맵" />}
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
