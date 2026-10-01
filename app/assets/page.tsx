"use client";

import { FunctionsHttpError } from "@supabase/supabase-js";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import AuthGuard from "../auth-guard";
import { supabase } from "@/lib/supabase/client";
import { Asset, assetImagePaths } from "./asset-images";
import { validateUpload } from "./upload-validation";

const acceptedImages = "image/jpeg,image/png,image/webp,image/gif";

async function errorMessage(error: unknown) {
  let detail = error instanceof Error ? error.message : "";
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    const body = await error.context.clone().json().catch(() => null) as { error?: string } | null;
    detail = body?.error ?? detail;
  }
  if (detail.includes("allowed")) return "JPEG, PNG, WebP, GIF 이미지만 업로드할 수 있습니다.";
  if (detail.includes("smaller")) return "파일 용량 제한을 확인하세요. 맵은 10MB, 나머지 이미지와 썸네일은 5MB까지 가능합니다.";
  if (detail.includes("authentication")) return "로그인이 만료되었습니다. 다시 로그인하세요.";
  return "이미지를 업로드할 수 없습니다. 잠시 후 다시 시도하세요.";
}

export default function Assets() {
  const [busy, setBusy] = useState(false);
  const [assets, setAssets] = useState<(Asset & { thumbnailUrl?: string; mapUrl?: string })[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [assetsError, setAssetsError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadAssets() {
    setLoadingAssets(true);
    setAssetsError("");
    try {
      const { data, error: queryError } = await supabase
        .from("assets")
        .select("id, category, storage_path, thumbnail_storage_path, created_at")
        .order("created_at", { ascending: false });
      if (queryError) throw queryError;

      const imagePaths = assetImagePaths(data);
      const { data: signedUrls, error: signedUrlError } = imagePaths.length
        ? await supabase.storage.from("assets").createSignedUrls(imagePaths, 60 * 60)
        : { data: [], error: null };
      if (signedUrlError) throw signedUrlError;
      const urls = new Map(signedUrls.map(({ path, signedUrl }) => [path, signedUrl]));
      setAssets(data.map((asset) => ({
        ...asset,
        thumbnailUrl: asset.thumbnail_storage_path ? urls.get(asset.thumbnail_storage_path) ?? undefined : undefined,
        mapUrl: asset.category === "map" ? urls.get(asset.storage_path) ?? undefined : undefined,
      })));
    } catch {
      setAssetsError("자산 목록을 불러올 수 없습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setLoadingAssets(false);
    }
  }

  useEffect(() => { void loadAssets(); }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    const file = body.get("file");
    const thumbnailValue = body.get("thumbnail");
    const thumbnail = thumbnailValue instanceof File && thumbnailValue.size ? thumbnailValue : undefined;

    if (!(file instanceof File)) {
      setError("업로드할 이미지를 선택하세요.");
      return;
    }

    const validationError = validateUpload(String(body.get("category") ?? ""), file, thumbnail);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!thumbnail) body.delete("thumbnail");

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { error: uploadError } = await supabase.functions.invoke("upload-asset", { body });
      if (uploadError) {
        setError(await errorMessage(uploadError));
        return;
      }
      form.reset();
      setMessage("자산을 업로드했습니다.");
      void loadAssets();
    } catch {
      setError("업로드 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard><main className="create-room-shell"><div className="assets-content">
      <form className="login-card create-room-card" onSubmit={handleSubmit} aria-busy={busy}>
        <Link className="brand" href="/">ELLIMIUM</Link>
        <div className="profile-heading"><p className="eyebrow">ASSET LIBRARY</p><h1>이미지 자산 추가</h1></div>
        <label>카테고리<select name="category" defaultValue="map" disabled={busy}>
          <option value="map">맵 · 최대 10MB</option>
          <option value="token">토큰 · 최대 5MB</option>
          <option value="item">아이템 · 최대 5MB</option>
          <option value="other">기타 · 최대 5MB</option>
        </select></label>
        <label>이미지<input name="file" type="file" accept={acceptedImages} required disabled={busy} /></label>
        <label>썸네일 <small>선택 · 최대 5MB</small><input name="thumbnail" type="file" accept={acceptedImages} disabled={busy} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="form-message" role="status">{message}</p>}
        <button className="primary-button full-button" type="submit" disabled={busy}>{busy ? "업로드 중…" : "자산 업로드"}</button>
        <p className="form-foot"><Link href="/">← 캠페인으로 돌아가기</Link></p>
      </form>
      <section className="asset-library" aria-labelledby="asset-list-title" aria-busy={loadingAssets}>
        <div className="asset-library-heading"><div><p className="eyebrow">UPLOADED ASSETS</p><h2 id="asset-list-title">내 자산</h2></div><span>{assets.length}개</span></div>
        {assetsError && <p className="form-error" role="alert">{assetsError}</p>}
        {loadingAssets ? <p className="muted">자산을 불러오는 중…</p> : assets.length === 0 ? <p className="muted">아직 업로드한 자산이 없습니다.</p> : <div className="asset-grid">
          {assets.map((asset) => <article className="asset-card" key={asset.id}>
            <div className="asset-thumbnail">{asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt={`${asset.category} 썸네일`} /> : <span>{asset.category}</span>}</div>
            <div><strong>{asset.category === "map" ? "맵" : asset.category === "token" ? "토큰" : asset.category === "item" ? "아이템" : "기타"}</strong><small>{asset.thumbnailUrl ? "사용자 썸네일" : "기본 썸네일"}</small></div>
            {asset.mapUrl && <img className="asset-map-result" src={asset.mapUrl} alt="리사이징된 맵 결과" />}
          </article>)}
        </div>}
      </section>
    </div></main></AuthGuard>
  );
}
