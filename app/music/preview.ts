type PreviewAudio = Pick<HTMLAudioElement, "src" | "currentTime" | "duration" | "paused" | "play" | "pause" | "load" | "removeAttribute" | "addEventListener" | "removeEventListener">;
type SignedMusic = { signedUrl: string; expiresIn: number };

export function startMusicPreview(
  audio: PreviewAudio,
  issueUrl: () => Promise<SignedMusic>,
  onError: (message: string) => void,
  onLoading: (loading: boolean) => void,
) {
  let active = true;
  let failed = false;
  let refreshing = false;
  let initial = true;
  let expiresAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onMetadata: (() => void) | undefined;

  function clearAudio() {
    clearTimeout(timer);
    if (onMetadata) audio.removeEventListener("loadedmetadata", onMetadata);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  function fail(message: string) {
    if (!active || failed) return;
    failed = true;
    clearAudio();
    onError(message);
    onLoading(false);
  }

  async function renew(resume?: boolean) {
    if (!active || failed || refreshing) return;
    refreshing = true;
    onLoading(true);
    const requestedAt = Date.now();
    try {
      const data = await issueUrl();
      if (!active) return;
      if (!data || typeof data.signedUrl !== "string" ||
          !Number.isFinite(data.expiresIn) || data.expiresIn <= 0 || data.expiresIn > 300 ||
          requestedAt + data.expiresIn * 1000 <= Date.now() ||
          !["http:", "https:"].includes(new URL(data.signedUrl).protocol)) {
        throw new Error("음악 URL을 발급받지 못했습니다. 다시 시도하세요.");
      }
      const position = initial ? 0 : audio.currentTime;
      const shouldPlay = initial || (resume ?? !audio.paused);
      initial = false;
      if (onMetadata) audio.removeEventListener("loadedmetadata", onMetadata);
      onMetadata = () => {
        if (!active || failed) return;
        audio.currentTime = Math.min(position, Number.isFinite(audio.duration) ? audio.duration : position);
        if (shouldPlay) void audio.play().catch((error: unknown) => {
          if (!active || failed) return;
          if (error instanceof Error && error.name === "NotAllowedError") {
            onError("재생 버튼을 눌러 음악을 시작하세요.");
          } else if (!(error instanceof Error && error.name === "AbortError")) {
            fail("음악을 재생할 수 없습니다. 파일과 브라우저의 지원 형식을 확인하세요.");
          }
        });
      };
      audio.addEventListener("loadedmetadata", onMetadata, { once: true });
      expiresAt = requestedAt + data.expiresIn * 1000;
      audio.src = data.signedUrl;
      audio.load();
      clearTimeout(timer);
      timer = setTimeout(() => void renew(), Math.max(0, expiresAt - Date.now()));
    } catch (error) {
      fail(error instanceof Error ? error.message : "음악 URL을 발급받지 못했습니다. 다시 시도하세요.");
    } finally {
      refreshing = false;
      if (active && !failed) onLoading(false);
    }
  }

  function onMediaError() {
    if (!active || failed || refreshing) return;
    if (expiresAt && Date.now() >= expiresAt) void renew();
    else fail("음악 파일을 불러오거나 디코딩할 수 없습니다. 다시 시도하세요.");
  }

  function onPlay() {
    if (!active || failed) return;
    onError("");
    if (expiresAt && Date.now() >= expiresAt) {
      audio.pause();
      void renew(true);
    }
  }

  audio.addEventListener("error", onMediaError);
  audio.addEventListener("play", onPlay);
  void renew();
  return () => {
    active = false;
    audio.removeEventListener("error", onMediaError);
    audio.removeEventListener("play", onPlay);
    clearAudio();
  };
}
