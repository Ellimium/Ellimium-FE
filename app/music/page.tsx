"use client";

import { FunctionsHttpError } from "@supabase/supabase-js";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import AuthGuard from "../auth-guard";
import { MusicAsset, musicDuration, musicFormat, musicMutationError, musicSize, musicUploadBody, musicUploadError } from "./music";

export default function MusicPage() {
  return <AuthGuard><MusicLibrary /></AuthGuard>;
}

function MusicLibrary() {
  const [music, setMusic] = useState<MusicAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedTitle, setEditedTitle] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const locked = busy || mutating;
  const requestId = useRef(0);

  const loadMusic = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    setListError("");
    try {
      // RLS restricts this query to the authenticated owner's library.
      const { data, error: queryError } = await supabase.from("music_assets")
        .select("id, title, mime_type, file_size_bytes, duration_ms, deletion_pending")
        .order("created_at", { ascending: false });
      if (current !== requestId.current) return;
      if (queryError) throw queryError;
      setMusic(data ?? []);
    } catch {
      if (current === requestId.current) setListError("음악 목록을 불러오지 못했습니다. 다시 시도하세요.");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMusic();
    return () => { requestId.current++; };
  }, [loadMusic]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = new FormData(form);
    setError("");
    setMessage("");
    let body: FormData;
    try {
      const file = input.get("file");
      if (!(file instanceof File)) throw new Error("음악 파일을 선택하세요.");
      body = musicUploadBody(String(input.get("title") ?? ""), file);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "음악 파일을 확인하세요.");
      return;
    }
    setBusy(true);
    try {
      const { error: uploadError } = await supabase.functions.invoke("upload-music", { body });
      if (uploadError) {
        if (uploadError instanceof FunctionsHttpError && uploadError.context instanceof Response) {
          const response = uploadError.context;
          const detail = await response.clone().json().catch(() => null);
          setError(musicUploadError(response.status, detail));
        } else {
          setError("업로드 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.");
        }
        return;
      }
      form.reset();
      setMessage("음악을 업로드했습니다.");
      await loadMusic();
    } catch {
      setError("업로드 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  }

  async function renameMusic(event: FormEvent<HTMLFormElement>, musicAssetId: string) {
    event.preventDefault();
    setActionError("");
    setActionMessage("");
    if (!editedTitle.trim()) {
      setActionError("음악 제목을 입력하세요.");
      return;
    }
    setMutating(true);
    try {
      const { error: renameError, status } = await supabase.rpc("rename_music_asset", {
        target_music_asset_id: musicAssetId, new_title: editedTitle.trim(),
      });
      if (renameError) setActionError(musicMutationError("rename", renameError.code, status));
      else {
        setEditingId(null);
        setActionMessage("음악 제목을 변경했습니다.");
      }
      await loadMusic();
    } catch {
      setActionError(musicMutationError("rename"));
    } finally {
      setMutating(false);
    }
  }

  async function deleteMusic(musicAssetId: string) {
    setActionError("");
    setActionMessage("");
    setMutating(true);
    try {
      const { data, error: deleteError } = await supabase.functions.invoke("delete-music", {
        body: { musicAssetId },
      });
      if (deleteError) {
        const status = deleteError instanceof FunctionsHttpError && deleteError.context instanceof Response
          ? deleteError.context.status : undefined;
        setActionError(musicMutationError("delete", undefined, status));
      } else {
        setDeleteId(null);
        setActionMessage(data?.deleted === false ? "이미 삭제된 음악입니다. 목록을 갱신했습니다." : "음악을 삭제했습니다.");
      }
      // Failed cleanup may have left deletion_pending metadata for retry.
      await loadMusic();
    } catch {
      setActionError(musicMutationError("delete"));
      await loadMusic();
    } finally {
      setMutating(false);
    }
  }

  return <main className="create-room-shell"><div className="assets-content">
    <form className="login-card create-room-card" onSubmit={handleSubmit} aria-busy={busy}>
      <Link className="brand" href="/">ELLIMIUM</Link>
      <div className="profile-heading"><p className="eyebrow">MUSIC LIBRARY</p><h1>음악 추가</h1></div>
      <label>제목<input name="title" required disabled={locked} /></label>
      <label>음악 파일<input name="file" type="file" accept=".mp3,.ogg,.wav,audio/mpeg,audio/ogg,audio/wav,audio/x-wav,application/ogg" required disabled={locked} /></label>
      <p className="muted">MP3 · OGG · WAV 파일의 형식과 재생 시간을 확인한 후 저장합니다.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-message" role="status">{message}</p>}
      <button className="primary-button full-button" type="submit" disabled={locked}>{busy ? "검증 및 업로드 중…" : "음악 업로드"}</button>
      <p className="form-foot"><Link href="/">← 캠페인으로 돌아가기</Link></p>
    </form>
    <section className="asset-library" aria-labelledby="music-list-title" aria-busy={loading}>
      <div className="asset-library-heading"><div><p className="eyebrow">UPLOADED MUSIC</p><h2 id="music-list-title">내 음악</h2></div><span>{music.length}개</span></div>
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {actionMessage && <p className="form-message" role="status">{actionMessage}</p>}
      {listError && <div><p className="form-error" role="alert">{listError}</p><button className="secondary-button" type="button" onClick={() => void loadMusic()} disabled={loading}>목록 다시 불러오기</button></div>}
      {loading ? <p className="muted">음악을 불러오는 중…</p> : !listError && music.length === 0 ? <p className="muted">아직 업로드한 음악이 없습니다.</p> : <ul className="music-list">
        {music.map((asset) => <li className="music-card" key={asset.id}>
          <strong>{asset.title}</strong>
          <span className="muted">{musicFormat(asset.mime_type)} · {musicSize(asset.file_size_bytes)} · {musicDuration(asset.duration_ms)}</span>
          {asset.deletion_pending && <small className="form-error">삭제 처리 중</small>}
          {editingId === asset.id && !asset.deletion_pending ? <form className="music-edit" onSubmit={(event) => void renameMusic(event, asset.id)}>
            <label>새 제목<input value={editedTitle} onChange={(event) => setEditedTitle(event.target.value)} required disabled={locked} /></label>
            <div className="music-actions"><button className="primary-button" type="submit" disabled={locked}>제목 저장</button><button className="secondary-button" type="button" onClick={() => setEditingId(null)} disabled={locked}>취소</button></div>
          </form> : <div className="music-actions">
            <button className="secondary-button" type="button" disabled={locked || asset.deletion_pending} onClick={() => { setEditingId(asset.id); setEditedTitle(asset.title); setDeleteId(null); setActionError(""); setActionMessage(""); }}>제목 변경</button>
            <button className="secondary-button" type="button" disabled={locked} onClick={() => { setDeleteId(asset.id); setEditingId(null); setActionError(""); setActionMessage(""); }}>{asset.deletion_pending ? "삭제 재시도" : "삭제"}</button>
          </div>}
          {deleteId === asset.id && <div role="group" aria-label={`${asset.title} 삭제 확인`}>
            <p>음악을 삭제하면 이 음악을 사용하는 모든 룸에서 재생이 정지됩니다. 삭제할까요?</p>
            <div className="music-actions"><button className="primary-button" type="button" disabled={locked} onClick={() => void deleteMusic(asset.id)}>{mutating ? "삭제 중…" : "삭제 확인"}</button><button className="secondary-button" type="button" disabled={locked} onClick={() => setDeleteId(null)}>취소</button></div>
          </div>}
        </li>)}
      </ul>}
    </section>
  </div></main>;
}
