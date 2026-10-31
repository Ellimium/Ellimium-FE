export async function sharedImageUrls(
  paths: string[], token: string, signal: AbortSignal,
) {
  const uniquePaths = [...new Set(paths)];
  const results = await Promise.allSettled(uniquePaths.map(async (path) => {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/authenticated/assets/${encodedPath}`,
      {
        headers: { Authorization: `Bearer ${token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
        cache: "no-store", signal,
      },
    );
    if (!response.ok) throw new Error("공유 이미지에 접근할 수 없습니다.");
    return response.blob();
  }));
  signal.throwIfAborted();
  return new Map(results.flatMap((result, index) => result.status === "fulfilled"
    ? [[uniquePaths[index], URL.createObjectURL(result.value)]] : []));
}

export function releaseSharedImages(urls: Map<string, string>) {
  for (const url of urls.values()) URL.revokeObjectURL(url);
}
