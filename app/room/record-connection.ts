import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export type RecordConnectionState = "connecting" | "syncing" | "ready" | "disconnected" | "error";
export const RECORD_CONNECTION_LABELS: Record<RecordConnectionState, string> = {
  connecting: "연결 중", syncing: "기록 동기화 중", ready: "연결됨", disconnected: "연결 끊김 · 복구 대기", error: "기록 동기화 실패",
};
export function roomRecordState(states: RecordConnectionState[]): RecordConnectionState {
  for (const state of ["disconnected", "error", "connecting", "syncing"] as const) if (states.includes(state)) return state;
  return "ready";
}

export function startRecordConnection(
  client: SupabaseClient,
  createChannel: () => RealtimeChannel,
  sync: () => Promise<boolean | undefined>,
  publish: (state: RecordConnectionState, retry: () => void) => void,
  browser: { window: EventTarget; online: boolean },
) {
  let active = true;
  let connected = false;
  let online = browser.online;
  let version = 0;
  let channel: RealtimeChannel | undefined;
  let reconnecting = false;
  const report = (state: RecordConnectionState) => { if (active) publish(state, retry); };
  async function refresh() {
    if (!active || !online) return;
    const request = ++version;
    report(connected ? "syncing" : "connecting");
    let success = false;
    try { success = await sync() === true; } catch { /* The caller displays the query error. */ }
    if (!active || request !== version) return;
    report(success ? connected ? "ready" : "connecting" : "error");
  }
  function subscribe() {
    channel = createChannel();
    const current = channel;
    channel.subscribe((status) => {
      if (!active || current !== channel) return;
      if (status === "SUBSCRIBED" && online) {
        connected = true;
        void refresh();
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        connected = false;
        version++;
        report("disconnected");
      }
    });
  }
  async function reconnect() {
    if (!active || reconnecting) return;
    reconnecting = true;
    connected = false;
    version++;
    report("connecting");
    const previous = channel;
    channel = undefined;
    try {
      if (previous) await client.removeChannel(previous);
      if (active && online) subscribe();
    } catch {
      report("disconnected");
    } finally {
      reconnecting = false;
    }
  }
  function retry() {
    if (!active) return;
    if (!online) { report("disconnected"); return; }
    if (connected) void refresh();
    else void reconnect();
  }
  const offline = () => { online = false; connected = false; version++; report("disconnected"); };
  const onOnline = () => { online = true; retry(); };
  browser.window.addEventListener("offline", offline);
  browser.window.addEventListener("online", onOnline);
  report(online ? "connecting" : "disconnected");
  if (online) { subscribe(); void refresh(); }
  return () => {
    active = false;
    version++;
    browser.window.removeEventListener("offline", offline);
    browser.window.removeEventListener("online", onOnline);
    if (channel) void client.removeChannel(channel);
  };
}
