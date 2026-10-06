"use client";

import { FormEvent, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import { AssetFolder, folderError, orderedFolders } from "./folders";

export default function AssetFolders() {
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState("");
  const tree = orderedFolders(folders);
  const parent = folders.find((folder) => folder.id === parentId);
  const locked = loading || saving || !!loadError;

  async function loadFolders() {
    setLoading(true);
    setLoadError("");
    try {
      const { data, error: queryError } = await supabase.from("asset_folders")
        .select("id, name, parent_id, depth").order("name");
      if (queryError) throw queryError;
      setFolders(data);
      setParentId((current) => data.some((folder) => folder.id === current) ? current : "");
      setEditingId((current) => data.some((folder) => folder.id === current) ? current : null);
    } catch {
      setLoadError("폴더 목록을 불러올 수 없습니다. 잠시 후 새로고침하세요.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadFolders(); }, []);

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setError("");
    setMessage("");
    if (!name.trim()) { setError("폴더 이름을 입력하세요."); return; }
    if (parentId && !parent) { setError("상위 폴더를 다시 선택하세요."); return; }
    if (parent && parent.depth >= 3) { setError("폴더는 최대 3단계까지 만들 수 있습니다."); return; }
    setSaving(true);
    try {
      const { error: createError } = await supabase.from("asset_folders").insert({
        name: name.trim(), parent_id: parentId || null, depth: parent ? parent.depth + 1 : 1,
      });
      if (createError) { setError(folderError("create", createError.code)); return; }
      setName("");
      setMessage("폴더를 만들었습니다.");
      await loadFolders();
    } catch { setError(folderError("create")); }
    finally { setSaving(false); }
  }

  async function renameFolder(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (locked) return;
    setError("");
    setMessage("");
    if (!editedName.trim()) { setError("폴더 이름을 입력하세요."); return; }
    setSaving(true);
    try {
      const { error: renameError } = await supabase.from("asset_folders")
        .update({ name: editedName.trim() }).eq("id", id).select("id").single();
      if (renameError) { setError(folderError("rename", renameError.code)); return; }
      setEditingId(null);
      setMessage("폴더 이름을 변경했습니다.");
      await loadFolders();
    } catch { setError(folderError("rename")); }
    finally { setSaving(false); }
  }

  async function deleteFolder(id: string) {
    if (locked) return;
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const { error: deleteError } = await supabase.from("asset_folders")
        .delete().eq("id", id).select("id").single();
      if (deleteError) { setError(folderError("delete", deleteError.code)); return; }
      setMessage("빈 폴더를 삭제했습니다.");
      await loadFolders();
    } catch { setError(folderError("delete")); }
    finally { setSaving(false); }
  }

  return <section className="asset-library asset-folders" aria-labelledby="folder-title" aria-busy={loading || saving}>
    <div className="asset-library-heading"><h2 id="folder-title">내 폴더</h2>
      <button className="secondary-button" type="button" disabled={loading || saving} onClick={() => void loadFolders()}>폴더 새로고침</button>
    </div>
    <p className="muted" id="folder-rules">최상위 폴더는 1단계이며 최대 3단계까지 만들 수 있습니다. 빈 폴더만 삭제할 수 있습니다. 자산이나 하위 폴더가 있으면 먼저 정리하세요.</p>
    {loadError && <p className="form-error" role="alert">{loadError}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-message" role="status">{message}</p>}
    <form className="folder-create" onSubmit={createFolder} aria-describedby="folder-rules">
      <label>상위 폴더<select value={parentId} disabled={locked} onChange={(event) => setParentId(event.target.value)}>
        <option value="">최상위에 만들기 · 1단계</option>
        {tree.map((folder) => <option key={folder.id} value={folder.id} disabled={folder.depth >= 3}>
          {"─ ".repeat(folder.depth - 1)}{folder.name} · {folder.depth}단계{folder.depth >= 3 ? " (하위 생성 불가)" : ""}
        </option>)}
      </select></label>
      <label>새 폴더 이름<input value={name} required disabled={locked} onChange={(event) => setName(event.target.value)} /></label>
      <button className="primary-button" type="submit" disabled={locked || (parent?.depth ?? 0) >= 3}>폴더 만들기</button>
    </form>
    {loading ? <p className="muted">폴더를 불러오는 중…</p> : !loadError && tree.length === 0 ? <p className="muted">아직 폴더가 없습니다.</p> : <ul className="folder-list">
      {tree.map((folder) => <li key={folder.id} style={{ marginLeft: (folder.depth - 1) * 16 }}>
        {editingId === folder.id ? <form className="folder-rename" onSubmit={(event) => void renameFolder(event, folder.id)}>
          <label>{folder.name} 새 이름<input value={editedName} required disabled={locked} onChange={(event) => setEditedName(event.target.value)} /></label>
          <button className="primary-button" type="submit" disabled={locked}>이름 저장</button>
          <button className="secondary-button" type="button" disabled={locked} onClick={() => setEditingId(null)}>취소</button>
        </form> : <>
          <span className="folder-name"><strong>{folder.name}</strong><small>{folder.depth}단계</small></span>
          <button className="secondary-button" type="button" disabled={locked} aria-label={`${folder.name} 이름 변경`} onClick={() => { setEditingId(folder.id); setEditedName(folder.name); }}>이름 변경</button>
          <button className="secondary-button" type="button" disabled={locked} aria-label={`${folder.name} 삭제`} onClick={() => void deleteFolder(folder.id)}>삭제</button>
        </>}
      </li>)}
    </ul>}
  </section>;
}
