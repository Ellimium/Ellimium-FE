import type { JukeboxState } from "./jukebox.ts";

type Audio = Pick<HTMLAudioElement, "src" | "duration" | "currentTime" | "paused" | "loop" | "volume" | "muted" | "play" | "pause" | "load" | "removeAttribute" | "addEventListener" | "removeEventListener">;
export type SignedJukeboxMusic = { signedUrl: string; expiresIn: number };
export type JukeboxAudioView = { loading: boolean; needsActivation: boolean; error: string; volume: number; muted: boolean; duration: number | null };
export function emptyJukeboxAudio(): JukeboxAudioView {
  return { loading: false, needsActivation: true, error: "", volume: 1, muted: false, duration: null };
}
export function jukeboxPosition(state: JukeboxState, duration: number, now = Date.now()) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const elapsed = state.status === "playing" ? Math.max(0, now - Date.parse(state.state_changed_at)) : 0;
  const seconds = (state.position_ms + elapsed) / 1000;
  return state.loop_enabled ? seconds % duration : Math.min(seconds, duration);
}

export function startJukeboxAudio(
  audio: Audio,
  issueUrl: (musicId: string) => Promise<SignedJukeboxMusic>,
  changed: (view: JukeboxAudioView) => void,
  accessDenied: () => void,
) {
  let view = emptyJukeboxAudio();
  let state: JukeboxState | null = null;
  let musicId: string | null = null;
  let active = true;
  let enabled = false;
  let ready = false;
  let failed = false;
  let issuing = false;
  let playing = false;
  let generation = 0;
  let expiresAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function publish(patch: Partial<JukeboxAudioView>) {
    if (!active) return;
    view = { ...view, ...patch }; changed(view);
  }
  function clear() {
    generation++;
    clearTimeout(timer);
    ready = false; issuing = false; playing = false; expiresAt = 0;
    audio.pause(); audio.removeAttribute("src"); audio.load();
  }
  function fail(message: string) {
    failed = true; clear(); publish({ error: message, loading: false, duration: null });
  }
  function apply() {
    if (!active || failed || !ready || !state || !musicId) return;
    if (expiresAt && Date.now() >= expiresAt) { void renew(); return; }
    const position = jukeboxPosition(state, audio.duration);
    audio.loop = state.loop_enabled;
    if (audio.paused || Math.abs(audio.currentTime - position) > 0.25) audio.currentTime = position;
    if (!enabled || state.status !== "playing" || (!state.loop_enabled && position >= audio.duration)) {
      audio.pause(); return;
    }
    if (audio.paused && !playing) {
      const attempt = generation;
      const playingState = state;
      playing = true;
      void audio.play().then(() => {
        if (!active || attempt !== generation) return;
        publish({ needsActivation: false });
        if (!enabled || state?.status !== "playing") audio.pause();
      }).catch((error: unknown) => {
        if (!active || attempt !== generation) return;
        if (error instanceof Error && error.name === "NotAllowedError") {
          enabled = false; audio.pause();
          publish({ needsActivation: true, error: "오디오 활성화를 눌러 음악을 시작하세요." });
        } else if (!(error instanceof Error && error.name === "AbortError")) {
          fail("음악을 재생할 수 없습니다. 파일과 지원 형식을 확인하세요.");
        }
      }).finally(() => {
        if (attempt !== generation) return;
        playing = false;
        if (active && !failed && playingState !== state) apply();
      });
    }
  }
  async function renew() {
    if (!active || failed || issuing || !musicId) return;
    const requestedId = musicId;
    const request = ++generation;
    playing = false;
    const requestedAt = Date.now();
    issuing = true; ready = false; audio.pause(); audio.removeAttribute("src"); audio.load();
    publish({ loading: true, error: "", duration: null });
    try {
      const data = await issueUrl(requestedId);
      if (!active || request !== generation) return;
      if (!data || typeof data.signedUrl !== "string" || !Number.isFinite(data.expiresIn) || data.expiresIn <= 0 || data.expiresIn > 300 ||
          requestedAt + data.expiresIn * 1000 <= Date.now() || !["http:", "https:"].includes(new URL(data.signedUrl).protocol)) {
        throw new Error("음악 URL을 발급받지 못했습니다. 다시 시도하세요.");
      }
      expiresAt = requestedAt + data.expiresIn * 1000;
      audio.src = data.signedUrl; audio.load();
      clearTimeout(timer);
      timer = setTimeout(() => { void renew(); }, Math.max(0, expiresAt - Date.now()));
    } catch (error) {
      if (!active || request !== generation) return;
      fail(error instanceof Error ? error.message : "음악 URL을 발급받지 못했습니다. 다시 시도하세요.");
      if (error && typeof error === "object" && "accessDenied" in error && error.accessDenied) accessDenied();
    } finally {
      if (request === generation) issuing = false;
    }
  }
  function metadata() {
    if (!active || failed || !audio.src || !musicId) return;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      fail("음악 파일의 재생 시간을 확인할 수 없습니다."); return;
    }
    ready = true; publish({ loading: false, duration: audio.duration }); apply();
  }
  function mediaError() {
    if (!active || failed || !musicId || issuing) return;
    if (expiresAt && Date.now() >= expiresAt) void renew();
    else fail("음악 파일을 불러오거나 디코딩할 수 없습니다. 다시 시도하세요.");
  }
  audio.volume = view.volume; audio.muted = view.muted;
  audio.addEventListener("loadedmetadata", metadata);
  audio.addEventListener("error", mediaError);
  const ended = () => { if (state?.loop_enabled) apply(); else audio.pause(); };
  audio.addEventListener("ended", ended);
  return {
    update(next: JukeboxState | null) {
      if (!active) return;
      state = next;
      const id = next?.status !== "stopped" ? next?.music_asset_id ?? null : null;
      if (id !== musicId) {
        clear(); musicId = id; failed = false;
        publish({ loading: false, error: "", duration: null });
        if (id) void renew();
      } else apply();
    },
    activate() {
      if (!active) return;
      enabled = true; publish({ needsActivation: false, error: "" }); apply();
    },
    retry() {
      if (!active || !musicId) return;
      clear(); failed = false; void renew();
    },
    setVolume(volume: number) {
      if (!active || !Number.isFinite(volume)) return;
      audio.volume = Math.max(0, Math.min(1, volume)); publish({ volume: audio.volume });
    },
    setMuted(muted: boolean) {
      if (!active) return;
      audio.muted = muted; publish({ muted });
    },
    dispose() {
      active = false;
      audio.removeEventListener("loadedmetadata", metadata);
      audio.removeEventListener("error", mediaError);
      audio.removeEventListener("ended", ended);
      clear(); musicId = null; state = null;
    },
  };
}
