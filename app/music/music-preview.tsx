"use client";

import { FunctionsHttpError } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { MusicAsset } from "./music";
import { startMusicPreview } from "./preview";

export default function MusicPreview({ asset, onClose }: { asset: MusicAsset; onClose: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setError("");
    return startMusicPreview(audio, async () => {
      const { data, error: issuanceError } = await supabase.functions.invoke("music-signed-url", {
        body: { musicAssetId: asset.id },
      });
      if (issuanceError) {
        const status = issuanceError instanceof FunctionsHttpError && issuanceError.context instanceof Response
          ? issuanceError.context.status : undefined;
        throw new Error(status === 401 ? "로그인이 만료되어 재생을 종료했습니다. 다시 로그인하세요."
          : status === 403 ? "음악 접근 권한이 없거나 삭제된 음악입니다. 재생을 종료했습니다."
          : "음악 URL을 발급받지 못했습니다. 다시 시도하세요.");
      }
      return data;
    }, setError, setLoading);
  }, [asset.id, attempt]);

  return <section className="music-preview" aria-label="음악 미리 듣기" aria-busy={loading}>
    <strong>{asset.title}</strong>
    {loading && <p className="muted" role="status">음악 URL을 확인하는 중…</p>}
    <audio ref={audioRef} controls preload="metadata" aria-label={`${asset.title} 미리 듣기`} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="music-actions">
      {error && <button className="secondary-button" type="button" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>다시 시도</button>}
      <button className="secondary-button" type="button" onClick={onClose}>미리 듣기 종료</button>
    </div>
  </section>;
}
