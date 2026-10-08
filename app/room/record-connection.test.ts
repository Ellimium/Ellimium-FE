import assert from "node:assert/strict";
import test from "node:test";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { roomRecordState, startRecordConnection, type RecordConnectionState } from "./record-connection.ts";

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => { resolve = done; });
  return { promise, resolve };
}
function harness(online = true) {
  const browser = { window: new EventTarget(), online };
  const callbacks: ((status: string) => void)[] = [];
  let state: RecordConnectionState = "connecting";
  let retry!: () => void;
  let reads = 0;
  let removes = 0;
  let query = async () => true;
  const client = { removeChannel: async () => { removes++; } } as unknown as SupabaseClient;
  const create = () => ({ subscribe: (callback: typeof callbacks[number]) => { callbacks.push(callback); } }) as unknown as RealtimeChannel;
  const dispose = startRecordConnection(client, create, () => { reads++; return query(); }, (next, again) => { state = next; retry = again; }, browser);
  return { browser, callbacks, dispose, get state() { return state; }, get reads() { return reads; }, get removes() { return removes; },
    retry() { retry(); }, query(next: typeof query) { query = next; } };
}

test("초기 조회만으로 연결됨을 표시하지 않고 구독 후 동기화 완료를 기다린다", async () => {
  const h = harness(); await settle();
  assert.equal(h.state, "connecting");
  const pending = deferred(); h.query(() => pending.promise);
  h.callbacks[0]("SUBSCRIBED"); assert.equal(h.state, "syncing");
  pending.resolve(true); await settle(); assert.equal(h.state, "ready"); h.dispose();
});

test("조회 실패 재시도는 같은 채널을 유지하고 기록만 다시 조회한다", async () => {
  const h = harness(); await settle(); h.query(async () => false);
  h.callbacks[0]("SUBSCRIBED"); await settle(); assert.equal(h.state, "error");
  h.query(async () => true); const before = h.reads; h.retry();
  assert.equal(h.state, "syncing"); await settle();
  assert.equal(h.state, "ready"); assert.equal(h.reads, before + 1); assert.equal(h.removes, 0); h.dispose();
});

test("단절 재시도는 채널을 교체하며 늦은 이전 채널 상태를 무시한다", async () => {
  for (const status of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) {
    const h = harness(); await settle(); const old = h.callbacks[0];
    old("SUBSCRIBED"); await settle(); old(status); assert.equal(h.state, "disconnected");
    h.retry(); assert.equal(h.state, "connecting"); await settle(); assert.equal(h.removes, 1);
    old("SUBSCRIBED"); old("CLOSED"); assert.equal(h.state, "connecting");
    h.callbacks[1]("SUBSCRIBED"); await settle(); assert.equal(h.state, "ready"); h.dispose();
  }
});

test("오프라인에는 조회·재시도를 멈추고 온라인 복귀 시 자동 연결·동기화한다", async () => {
  const h = harness(false); assert.equal(h.state, "disconnected"); h.retry(); assert.equal(h.reads, 0);
  h.browser.window.dispatchEvent(new Event("online")); await settle();
  assert.equal(h.state, "connecting"); h.callbacks[0]("SUBSCRIBED"); await settle(); assert.equal(h.state, "ready");
  const pending = deferred(); h.query(() => pending.promise); h.retry();
  h.browser.window.dispatchEvent(new Event("offline")); assert.equal(h.state, "disconnected");
  pending.resolve(true); await settle(); assert.equal(h.state, "disconnected");
  h.dispose(); const before = h.reads;
  h.callbacks[0]("SUBSCRIBED"); h.browser.window.dispatchEvent(new Event("online")); h.retry(); await settle();
  assert.equal(h.reads, before);
});

test("연속 동기화에서 이전 실패·종료 후 응답이 최신 상태를 덮지 않는다", async () => {
  const h = harness(); await settle(); const old = deferred(); h.query(() => old.promise);
  h.callbacks[0]("SUBSCRIBED"); h.query(async () => true); h.retry(); await settle();
  old.resolve(false); await settle(); assert.equal(h.state, "ready");
  const pending = deferred(); h.query(() => pending.promise); h.retry(); h.dispose();
  pending.resolve(true); await settle(); assert.equal(h.state, "syncing");
});

test("헤더는 두 기록 모두 준비되어야 연결됨이며 단절·실패를 우선 표시한다", () => {
  assert.equal(roomRecordState(["ready", "ready"]), "ready");
  for (const state of ["connecting", "syncing", "error", "disconnected"] as const) assert.equal(roomRecordState(["ready", state]), state);
  assert.equal(roomRecordState(["error", "disconnected"]), "disconnected");
});
