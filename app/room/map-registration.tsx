"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import type { Asset } from "../assets/asset-images";
import { supabase } from "@/lib/supabase/client";

type MapAsset = Pick<Asset, "id" | "storage_path">;

export default function MapRegistration({ roomId }: { roomId?: string }) {
  const [assets, setAssets] = useState<MapAsset[]>([]);
  const [isMaster, setIsMaster] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(Boolean(roomId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    if (!roomId) {
      setLoading(false);
      return;
    }

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      if (!user) {
        setIsMaster(false);
        setLoading(false);
        return;
      }

      const { data: member, error: memberError } = await supabase
        .from("room_members")
        .select("role")
        .eq("room_id", roomId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();

      if (!active) return;
      if (memberError) {
        setError("맵 등록 권한을 확인할 수 없습니다.");
        setLoading(false);
        return;
      }

      const master = member?.role === "master";
      setIsMaster(master);
      if (!master) {
        setLoading(false);
        return;
      }

      const { data, error: assetError } = await supabase
        .from("assets")
        .select("id, storage_path")
        .eq("category", "map")
        .order("created_at", { ascending: false });

      if (!active) return;
      if (assetError) setError("맵 자산을 불러올 수 없습니다.");
      else setAssets((data ?? []) as MapAsset[]);
      setLoading(false);
    }

    void load();
    return () => { active = false; };
  }, [roomId]);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomId) return;

    const form = new FormData(event.currentTarget);
    const number = (name: string) => {
      const value = String(form.get(name) ?? "");
      return value ? Number(value) : null;
    };

    setBusy(true);
    setError("");
    setMessage("");
    const { error: insertError } = await supabase.from("room_maps").insert({
      room_id: roomId,
      asset_id: String(form.get("assetId")),
      grid_cell_size: number("gridCellSize"),
      grid_offset_x: number("gridOffsetX"),
      grid_offset_y: number("gridOffsetY"),
    });
    setBusy(false);

    if (insertError) {
      setError("맵을 등록할 수 없습니다. 마스터 권한과 소유한 맵 자산을 확인하세요.");
      return;
    }
    setMessage("룸 맵을 등록했습니다.");
  }

  if (!roomId) return null;

  return <section className="map-registration" aria-label="룸 맵 등록" aria-busy={loading || busy}>
    <div className="panel-heading"><div><p className="eyebrow">MAP</p><h2>룸 맵</h2></div></div>
    {loading && <p className="muted">맵 설정을 불러오는 중…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!loading && isMaster === false && <p className="muted">맵 등록은 마스터만 할 수 있습니다.</p>}
    {!loading && isMaster && (assets.length ? <form onSubmit={register}>
      <label>맵 자산<select name="assetId" required disabled={busy}>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.storage_path.split("/").at(-1)}</option>)}</select></label>
      <div className="map-grid-inputs"><label>셀 크기<input name="gridCellSize" type="number" min="1" inputMode="numeric" placeholder="선택" disabled={busy} /></label><label>X 오프셋<input name="gridOffsetX" type="number" inputMode="numeric" placeholder="선택" disabled={busy} /></label><label>Y 오프셋<input name="gridOffsetY" type="number" inputMode="numeric" placeholder="선택" disabled={busy} /></label></div>
      {message && <p className="form-message" role="status">{message}</p>}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "등록 중…" : "맵 등록"}</button>
    </form> : <p className="muted">등록할 맵 자산이 없습니다. <Link href="/assets">맵 자산을 업로드하세요.</Link></p>)}
  </section>;
}
