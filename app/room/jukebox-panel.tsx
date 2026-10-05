"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import { musicDuration } from "../music/music";
import { jukeboxPosition } from "./jukebox-audio";
import { useRoomJukebox } from "./room-jukebox";

type Music = { id: string; title: string; duration_ms: number };

function MasterControls() {
  const { state, loading, pending, control } = useRoomJukebox();
  const [music, setMusic] = useState<Music[]>([]);
  const [selected, setSelected] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      setListLoading(true); setListError(""); setMusic([]);
      try {
        const { data, error } = await supabase.from("music_assets")
          .select("id, title, duration_ms").eq("deletion_pending", false).order("created_at", { ascending: false });
        if (!active) return;
        setMusic(data ?? []);
        setListError(error ? "음악 목록을 불러오지 못했습니다. 다시 시도하세요." : "");
      } catch {
        if (active) setListError("음악 서버에 연결할 수 없습니다. 다시 시도하세요.");
      } finally {
        if (active) setListLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [revision]);
  const disabled = loading || pending;
  const hasTrack = Boolean(state?.music_asset_id && state.status !== "stopped");
  const currentMusic = music.find((item) => item.id === state?.music_asset_id);
  function seek(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const seconds = Number(new FormData(event.currentTarget).get("position"));
    if (Number.isFinite(seconds) && seconds >= 0 && Number.isSafeInteger(Math.round(seconds * 1000))) {
      void control({ action: "seek", positionMs: Math.round(seconds * 1000) });
    }
  }
  return <div className="jukebox-master">
    {currentMusic && <p className="jukebox-track">{currentMusic.title} · {musicDuration(currentMusic.duration_ms)}</p>}
    <label>내 음악
      <select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={disabled || listLoading}>
        <option value="">음악 선택</option>
        {music.map((item) => <option key={item.id} value={item.id}>{item.title} · {musicDuration(item.duration_ms)}</option>)}
      </select>
    </label>
    {listLoading && <p className="form-message">음악 목록을 불러오는 중입니다.</p>}
    {listError && <p className="form-error" role="alert">{listError}</p>}
    {!listLoading && !listError && !music.length && <p className="form-message">음악 라이브러리에 음악을 추가하세요.</p>}
    <div className="jukebox-actions">
      <button type="button" disabled={disabled || !music.some((item) => item.id === selected)} onClick={() => void control({ action: "play", musicAssetId: selected })}>선택 음악 재생</button>
      <button type="button" disabled={disabled || !hasTrack} onClick={() => void control({ action: state?.status === "paused" ? "resume" : "pause" })}>{state?.status === "paused" ? "재개" : "일시 정지"}</button>
      <button type="button" disabled={disabled || !hasTrack} onClick={() => void control({ action: "stop" })}>정지</button>
    </div>
    <form className="jukebox-seek" onSubmit={seek}>
      <label>이동 위치 (초)<input key={state?.music_asset_id ?? "empty"} name="position" type="number" min="0" max="9007199254740" step="0.1" defaultValue="0" required disabled={disabled || !hasTrack} /></label>
      <button type="submit" disabled={disabled || !hasTrack}>위치 이동</button>
    </form>
    <label className="jukebox-checkbox"><input type="checkbox" checked={state?.loop_enabled ?? false} disabled={disabled || !hasTrack} onChange={(event) => void control({ action: "set_loop", loopEnabled: event.target.checked })} />한 곡 반복</label>
    <div className="jukebox-actions">
      <button type="button" disabled={listLoading} onClick={() => setRevision((value) => value + 1)}>음악 목록 새로고침</button>
      <Link href="/music">음악 라이브러리</Link>
    </div>
  </div>;
}

export default function Jukebox() {
  const { state, role, loading, pending, error, controlError, connectionError, audio, activateAudio, retryAudio, setVolume, setMuted, refresh } = useRoomJukebox();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!role || state?.status !== "playing") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [role, state?.status]);
  const hasTrack = Boolean(state?.music_asset_id && state.status !== "stopped");
  const status = state?.status === "playing" ? "재생 중" : state?.status === "paused" ? "일시 정지" : "정지";
  const position = state && audio.duration ? jukeboxPosition(state, audio.duration, Math.max(now, Date.parse(state.state_changed_at))) : null;
  return <section className="jukebox-panel" aria-label="주크박스">
    <div className="panel-heading"><div><p className="eyebrow">JUKEBOX</p><h2>주크박스</h2></div><span>{loading ? "확인 중" : role ? status : "접근 불가"}</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {connectionError && <p className="form-error" role="alert">{connectionError}</p>}
    <button type="button" className="jukebox-refresh" disabled={loading || pending} onClick={() => void refresh()}>상태 새로고침</button>
    {role && <>
      {hasTrack && <p className="jukebox-track">공유 음악 · {status}{state?.loop_enabled ? " · 한 곡 반복" : ""}{position !== null && <> · {musicDuration(position * 1000)} / {musicDuration(audio.duration! * 1000)}</>}</p>}
      {!hasTrack && !loading && <p className="form-message">선택된 음악이 없습니다.</p>}
      {role === "master" && <MasterControls />}
      {controlError && <p className="form-error" role="alert">{controlError}</p>}
      <fieldset className="jukebox-personal"><legend>내 오디오</legend>
        <label>음량 · {Math.round(audio.volume * 100)}%<input type="range" min="0" max="1" step="0.01" value={audio.volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
        <label className="jukebox-checkbox"><input type="checkbox" checked={audio.muted} onChange={(event) => setMuted(event.target.checked)} />음소거</label>
        {audio.loading && <p className="form-message">음악 파일을 불러오는 중입니다.</p>}
        {audio.error && <p className="form-error" role="alert">{audio.error}</p>}
        {audio.needsActivation ? <button type="button" disabled={!hasTrack || audio.loading} onClick={activateAudio}>오디오 활성화</button> : <p className="form-message">오디오 활성화됨</p>}
        {audio.error && hasTrack && <button type="button" disabled={audio.loading} onClick={retryAudio}>음악 다시 불러오기</button>}
      </fieldset>
    </>}
  </section>;
}
