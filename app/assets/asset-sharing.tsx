"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase/client";

function sharingError(code?: string) {
  if (code === "23505") return "이미 공유된 룸입니다. 갱신된 목록을 확인하세요.";
  if (code === "42501" || code === "PGRST116" || code === "23503") {
    return "자산 소유권이나 룸 참여 상태가 변경됐거나 이미 공유가 해제됐습니다. 목록을 확인하세요.";
  }
  return "공유 변경을 완료할 수 없습니다. 목록을 새로고침한 뒤 다시 시도하세요.";
}

export default function AssetSharing({ assetId, onChange, onClose }: {
  assetId: string; onChange: () => void; onClose: () => void;
}) {
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [shares, setShares] = useState<{ room_id: string }[]>([]);
  const [roomId, setRoomId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const availableRooms = rooms.filter((room) => !shares.some((share) => share.room_id === room.id));
  const selectedRoomId = availableRooms.some((room) => room.id === roomId) ? roomId : "";
  const locked = loading || saving || !!loadError;

  async function load(signal: AbortSignal) {
    setLoading(true);
    setLoadError("");
    try {
      const [roomResult, shareResult] = await Promise.all([
        supabase.from("rooms").select("id, name").order("created_at", { ascending: false }).abortSignal(signal),
        supabase.from("room_asset_shares").select("room_id").eq("asset_id", assetId)
          .order("created_at").abortSignal(signal),
      ]);
      if (roomResult.error || shareResult.error) throw roomResult.error ?? shareResult.error;
      if (signal.aborted) return;
      setRooms(roomResult.data);
      setShares(shareResult.data);
    } catch {
      if (!signal.aborted) setLoadError("공유 범위를 불러올 수 없습니다. 목록을 새로고침하세요.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    void load(current.signal);
    return () => current.abort();
  }, [assetId]);

  async function change(room: string, action: "share" | "unshare") {
    if (locked || !controller.current || (action === "share" && !availableRooms.some((item) => item.id === room))) return;
    setSaving(true);
    setError("");
    setMessage("");
    const signal = controller.current.signal;
    try {
      const query = supabase.from("room_asset_shares");
      const result = action === "share"
        ? await query.insert({ asset_id: assetId, room_id: room }).select("room_id").single()
        : await query.delete().eq("asset_id", assetId).eq("room_id", room).select("room_id").single();
      // Recheck the library even if this panel closed while the mutation completed.
      onChange();
      if (signal.aborted) return;
      if (result.error) setError(sharingError(result.error.code));
      else {
        setRoomId("");
        setMessage(action === "share" ? "자산을 룸에 공유했습니다." : "선택한 룸의 공유를 해제했습니다.");
      }
      await load(signal);
    } catch {
      onChange();
      if (!signal.aborted) { setError(sharingError()); await load(signal); }
    } finally {
      if (!signal.aborted) setSaving(false);
    }
  }

  function share(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedRoomId) void change(selectedRoomId, "share");
  }

  return <section id="asset-sharing-panel" className="asset-library" aria-labelledby="asset-sharing-title" aria-busy={loading || saving}>
    <div className="asset-library-heading"><div><p className="eyebrow">SHARE ASSET</p><h2 id="asset-sharing-title">자산 공유 관리</h2></div>
      <button className="secondary-button asset-refresh" type="button" disabled={saving} onClick={onClose}>공유 관리 닫기</button></div>
    <p className="muted">선택한 자산 · {assetId}</p>
    <button className="secondary-button asset-refresh" type="button" disabled={loading || saving}
      onClick={() => controller.current && void load(controller.current.signal)}>공유 목록 새로고침</button>
    {loadError && <p className="form-error" role="alert">{loadError}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-message" role="status">{message}</p>}
    {loading ? <p className="muted" role="status">공유 범위를 불러오는 중…</p> : loadError ? null : <>
      <form className="asset-move" onSubmit={share}>
        <label>공유할 룸<select value={selectedRoomId} disabled={locked || !availableRooms.length} onChange={(event) => setRoomId(event.target.value)} required>
          <option value="">룸을 선택하세요</option>
          {availableRooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select></label>
        <button className="secondary-button" type="submit" disabled={locked || !selectedRoomId}>자산 공유</button>
      </form>
      {!availableRooms.length && <p className="muted">새로 공유할 수 있는 참여 룸이 없습니다.</p>}
      <h3>현재 공유 범위</h3>
      {!shares.length ? <p className="muted">이 자산을 공유한 룸이 없습니다.</p> : <ul className="asset-sharing-list">
        {shares.map(({ room_id }) => <li key={room_id}>
          <span>{rooms.find((room) => room.id === room_id)?.name ?? `참여하지 않는 룸 · ${room_id}`}</span>
          <button className="secondary-button" type="button" disabled={locked} onClick={() => void change(room_id, "unshare")}>공유 해제</button>
        </li>)}
      </ul>}
    </>}
  </section>;
}
