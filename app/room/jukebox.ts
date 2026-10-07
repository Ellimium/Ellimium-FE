import type { SupabaseClient } from "@supabase/supabase-js";

export type JukeboxState = {
  room_id: string;
  music_asset_id: string | null;
  status: "playing" | "paused" | "stopped";
  position_ms: number;
  state_changed_at: string;
  loop_enabled: boolean;
};
export type JukeboxRole = "master" | "player" | "spectator";
export type JukeboxCommand =
  | { action: "play"; musicAssetId: string; positionMs?: number; loopEnabled?: boolean }
  | { action: "pause" | "resume" | "stop" }
  | { action: "seek"; positionMs: number }
  | { action: "set_loop"; loopEnabled: boolean };
export type JukeboxView = {
  state: JukeboxState | null;
  role: JukeboxRole | null;
  loading: boolean;
  pending: boolean;
  error: string;
  controlError: string;
  connectionError: string;
};
export const JUKEBOX_FIELDS = "room_id, music_asset_id, status, position_ms, state_changed_at, loop_enabled";
export function emptyJukeboxView(loading = false): JukeboxView {
  return { state: null, role: null, loading, pending: false, error: "", controlError: "", connectionError: "" };
}
export function isJukeboxState(value: unknown): value is JukeboxState {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.room_id === "string" &&
    (row.music_asset_id === null || typeof row.music_asset_id === "string") &&
    typeof row.status === "string" && ["playing", "paused", "stopped"].includes(row.status) &&
    typeof row.position_ms === "number" && Number.isSafeInteger(row.position_ms) && row.position_ms >= 0 &&
    typeof row.state_changed_at === "string" && Number.isFinite(Date.parse(row.state_changed_at)) &&
    typeof row.loop_enabled === "boolean" &&
    (row.music_asset_id !== null || row.status === "stopped");
}
export function jukeboxArguments(roomId: string, command: JukeboxCommand) {
  const args: Record<string, string | number | boolean> = { target_room_id: roomId, action: command.action };
  if (command.action === "play") {
    if (!command.musicAssetId) throw new Error("음악을 선택하세요.");
    args.target_music_asset_id = command.musicAssetId;
  }
  if (command.action === "play" || command.action === "seek") {
    if (command.positionMs !== undefined) {
      if (!Number.isSafeInteger(command.positionMs) || command.positionMs < 0) throw new Error("재생 위치를 확인하세요.");
      args.target_position_ms = command.positionMs;
    }
  }
  if ((command.action === "play" || command.action === "set_loop") && command.loopEnabled !== undefined) {
    args.target_loop_enabled = command.loopEnabled;
  }
  return args;
}
export function jukeboxControlError(code?: string) {
  if (code === "42501") return "활성 마스터만 주크박스를 변경할 수 있습니다.";
  if (code === "23514") return "삭제 처리 중인 음악은 재생할 수 없습니다.";
  if (code === "22023") return "선택한 음악과 재생 상태를 확인하세요.";
  return "주크박스 상태를 변경하지 못했습니다. 잠시 후 다시 시도하세요.";
}

type ReadResult = { state: JukeboxState | null; role: JukeboxRole | null };
export type JukeboxAccess = {
  read: () => Promise<ReadResult>;
  control: (command: JukeboxCommand) => Promise<void>;
  watch: (changed: () => void, status: (status: string) => void) => () => void;
};
export function jukeboxAccess(client: SupabaseClient, roomId: string, membershipRole: () => JukeboxRole | null): JukeboxAccess {
  return {
    async read() {
      const role = membershipRole();
      if (!role) return { state: null, role: null };
      const state = await client.from("room_jukebox_states").select(JUKEBOX_FIELDS).eq("room_id", roomId).maybeSingle();
      if (state.error) throw new Error("주크박스 상태를 불러오지 못했습니다.");
      if (!["master", "player", "spectator"].includes(role) ||
          (state.data !== null && (!isJukeboxState(state.data) || state.data.room_id !== roomId))) {
        throw new Error("주크박스 상태를 확인하지 못했습니다.");
      }
      return { state: state.data as JukeboxState | null, role: role as JukeboxRole };
    },
    async control(command) {
      const { error } = await client.rpc("control_room_jukebox", jukeboxArguments(roomId, command));
      if (error) throw new Error(jukeboxControlError(error.code));
    },
    watch(changed, status) {
      const filter = { schema: "public", table: "room_jukebox_states", filter: `room_id=eq.${roomId}` };
      const channel = client.channel(`room:${roomId}:jukebox:${crypto.randomUUID()}`)
        .on("postgres_changes", { ...filter, event: "INSERT" }, changed)
        .on("postgres_changes", { ...filter, event: "UPDATE" }, changed)
        .subscribe(status);
      return () => { void client.removeChannel(channel); };
    },
  };
}

// Keep reads authoritative: events and RPC completions invalidate the snapshot.
// A later read supersedes older in-flight work, including across room teardown.
export function startJukeboxSync(
  access: JukeboxAccess,
  changed: (view: JukeboxView) => void,
  browser: { window: EventTarget; document: EventTarget & { visibilityState: string } },
) {
  let view = emptyJukeboxView(true);
  let disposed = false;
  let version = 0;
  let sessionVersion = 0;
  let unwatch: (() => void) | undefined;
  let watchVersion = 0;
  function publish(patch: Partial<JukeboxView>) {
    if (disposed) return;
    view = { ...view, ...patch };
    changed(view);
  }
  function stopWatching() {
    watchVersion++;
    const stop = unwatch;
    unwatch = undefined;
    stop?.();
  }
  async function refresh() {
    if (disposed) return;
    const request = ++version;
    publish({ loading: true });
    try {
      const result = await access.read();
      if (disposed || request !== version) return;
      publish({ ...result, loading: false, error: result.role ? "" : "룸에 참가 중인 동안만 주크박스를 이용할 수 있습니다." });
      if (!result.role) {
        stopWatching();
      } else if (!unwatch) {
        const watching = ++watchVersion;
        unwatch = access.watch(() => { if (!disposed && watching === watchVersion) void refresh(); }, (status) => {
          if (disposed || watching !== watchVersion) return;
          if (status === "SUBSCRIBED") {
            publish({ connectionError: "" });
            void refresh();
          } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
            publish({ connectionError: "주크박스 실시간 연결이 끊겼습니다. 재연결을 기다리거나 다시 조회하세요." });
            if (status === "CLOSED") stopWatching();
          }
        });
      }
    } catch (error) {
      if (!disposed && request === version) publish({ state: null, role: null, loading: false, error: error instanceof Error ? error.message : "주크박스 서버에 연결하지 못했습니다." });
    }
  }
  async function control(command: JukeboxCommand) {
    if (disposed || view.pending) return;
    if (view.role !== "master" || view.loading) {
      publish({ controlError: jukeboxControlError("42501") });
      return;
    }
    const session = sessionVersion;
    publish({ pending: true, controlError: "" });
    try {
      await access.control(command);
      if (!disposed && session === sessionVersion) await refresh();
    } catch (error) {
      if (!disposed && session === sessionVersion) {
        await refresh();
        if (disposed || session !== sessionVersion) return;
        publish({ controlError: error instanceof Error ? error.message : jukeboxControlError() });
      }
    } finally {
      if (session === sessionVersion) publish({ pending: false });
    }
  }
  const online = () => { void refresh(); };
  const visible = () => { if (browser.document.visibilityState === "visible") void refresh(); };
  browser.window.addEventListener("online", online);
  browser.document.addEventListener("visibilitychange", visible);
  void refresh();
  return {
    refresh, control,
    leave() {
      sessionVersion++;
      version++;
      stopWatching();
      publish(emptyJukeboxView());
    },
    dispose() {
      disposed = true;
      sessionVersion++;
      version++;
      stopWatching();
      browser.window.removeEventListener("online", online);
      browser.document.removeEventListener("visibilitychange", visible);
    },
  };
}
