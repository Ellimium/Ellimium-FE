"use client";

import { useState } from "react";

export default function AssetImage({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string>();
  return src && src !== failedSrc
    ? <img src={src} alt={alt} className={className} onError={() => setFailedSrc(src)} />
    : <span className={className} role="img" aria-label={`${alt} · 이미지를 표시할 수 없습니다`}>이미지를 표시할 수 없습니다</span>;
}
