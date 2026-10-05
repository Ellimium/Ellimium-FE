import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isJukeboxState, jukeboxAccess, jukeboxArguments, startJukeboxSync,
  type JukeboxAccess, type JukeboxCommand, type JukeboxState, type JukeboxView,
} from "./jukebox.ts";

const state: JukeboxState = {
  room_id: "room-a", music_asset_id: "music-a", status: "playing", position_ms: 3000,
  state_changed_at: "2026-10-05T09:00:00.123456+00:00", loop_enabled: true,
};
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const views: JukeboxView[] = [];
  let reads = 0;
  let watches = 0;
  let closes = 0;
  const commands: JukeboxCommand[] = [];
  let change = () => {};
  let status = (_status: string) => {};
  const access: JukeboxAccess = {
    read: async () => { reads++; return { state, role: "master" }; },
    control: async (command) => { commands.push(command); },
    watch: (changed, changedStatus) => { watches++; change = changed; status = changedStatus; return () => { closes++; }; },
  };
  const sync = startJukeboxSync(access, (view) => views.push(view), { window, document });
  return { sync, access, window, document, commands, views, change: () => change(), status: (value: string) => status(value),
    get view() { return views.at(-1)!; }, get reads() { return reads; }, get watches() { return watches; }, get closes() { return closes; } };
}

test("주크박스 상태는 서버 시각·안전한 위치·빈 음악의 정지 상태를 검증한다", () => {
  assert.equal(isJukeboxState(state), true);
  assert.equal(isJukeboxState({ ...state, status: "stopped", music_asset_id: null, position_ms: 0 }), true);
  for (const patch of [{ status: "bad" }, { position_ms: -1 }, { position_ms: NaN }, { position_ms: 1.5 },
    { position_ms: Number.MAX_SAFE_INTEGER + 1 }, { state_changed_at: "bad" }, { music_asset_id: null }, { loop_enabled: "true" }]) {
    assert.equal(isJukeboxState({ ...state, ...patch }), false);
  }
});
test("제어 명령은 BE 인자 이름을 사용하고 false·0을 보존한다", () => {
  assert.deepEqual(jukeboxArguments("r", { action: "play", musicAssetId: "m", positionMs: 0, loopEnabled: false }),
    { target_room_id: "r", action: "play", target_music_asset_id: "m", target_position_ms: 0, target_loop_enabled: false });
  assert.deepEqual(jukeboxArguments("r", { action: "play", musicAssetId: "m" }), { target_room_id: "r", action: "play", target_music_asset_id: "m" });
  assert.deepEqual(jukeboxArguments("r", { action: "seek", positionMs: 0 }), { target_room_id: "r", action: "seek", target_position_ms: 0 });
  assert.deepEqual(jukeboxArguments("r", { action: "set_loop", loopEnabled: false }), { target_room_id: "r", action: "set_loop", target_loop_enabled: false });
  for (const action of ["pause", "resume", "stop"] as const) assert.deepEqual(jukeboxArguments("r", { action }), { target_room_id: "r", action });
  assert.throws(() => jukeboxArguments("r", { action: "play", musicAssetId: "" }));
  assert.throws(() => jukeboxArguments("r", { action: "seek", positionMs: -1 }));
});
test("입장·Realtime 변경·첫 구독·재연결은 서버 상태를 다시 조회한다", async () => {
  const h = setup(); await settle();
  assert.equal(h.view.state, state); assert.equal(h.watches, 1);
  h.change(); await settle();
  h.status("SUBSCRIBED"); await settle();
  h.status("CHANNEL_ERROR"); assert.match(h.view.connectionError, /실시간/);
  h.status("SUBSCRIBED"); await settle();
  assert.equal(h.reads, 4); assert.equal(h.watches, 1); assert.equal(h.view.connectionError, "");
  h.sync.dispose();
});
test("탭 활성화·네트워크 복구 때 조회하고 비활성 탭 이벤트는 무시한다", async () => {
  const h = setup(); await settle();
  h.document.visibilityState = "hidden"; h.document.dispatchEvent(new Event("visibilitychange")); await settle();
  assert.equal(h.reads, 1);
  h.document.visibilityState = "visible"; h.document.dispatchEvent(new Event("visibilitychange")); await settle();
  h.window.dispatchEvent(new Event("online")); await settle();
  assert.equal(h.reads, 3); h.sync.dispose();
});
test("이전 조회가 늦게 완료돼도 새 상태를 덮어쓰지 않는다", async () => {
  const h = setup(); await settle();
  const old = deferred<Awaited<ReturnType<JukeboxAccess["read"]>>>();
  h.access.read = () => old.promise;
  const pending = h.sync.refresh();
  const newer = { ...state, music_asset_id: "music-b", position_ms: 0 };
  h.access.read = async () => ({ role: "master", state: newer });
  h.change(); await settle();
  old.resolve({ role: "master", state }); await pending;
  assert.equal(h.view.state, newer); h.sync.dispose();
});
test("음악이 없는 활성 룸도 구독하며 첫 음악의 상태를 반영한다", async () => {
  const h = setup(); await settle();
  h.access.read = async () => ({ role: "player", state: null });
  await h.sync.refresh(); assert.equal(h.view.state, null); assert.equal(h.view.error, "");
  h.access.read = async () => ({ role: "player", state }); h.change(); await settle();
  assert.equal(h.view.state, state); h.sync.dispose();
});
test("플레이어·관전자는 읽지만 제어 요청을 보내지 않는다", async () => {
  const h = setup(); await settle();
  for (const role of ["player", "spectator"] as const) {
    h.access.read = async () => ({ role, state }); await h.sync.refresh();
    await h.sync.control({ action: "stop" }); assert.match(h.view.controlError, /마스터/);
  }
  assert.equal(h.commands.length, 0); h.sync.dispose();
});
test("동시 클릭은 한 RPC만 실행하고 완료 후 최신 상태를 재조회한다", async () => {
  const h = setup(); await settle();
  const rpc = deferred<void>(); h.access.control = async (command) => { h.commands.push(command); await rpc.promise; };
  const first = h.sync.control({ action: "pause" });
  await h.sync.control({ action: "stop" }); assert.equal(h.commands.length, 1); assert.equal(h.view.pending, true);
  const paused = { ...state, status: "paused" as const };
  h.access.read = async () => ({ role: "master", state: paused }); rpc.resolve(); await first;
  assert.equal(h.view.state, paused); assert.equal(h.view.pending, false); h.sync.dispose();
});
test("권한 거부 RPC 뒤 구성원 상태를 확인하고 구독과 기존 상태를 정리한다", async () => {
  const h = setup(); await settle();
  h.access.control = async () => { throw new Error("권한이 없습니다."); };
  h.access.read = async () => ({ state: null, role: null });
  await h.sync.control({ action: "stop" });
  assert.equal(h.view.state, null); assert.equal(h.view.role, null); assert.equal(h.closes, 1);
  assert.equal(h.view.controlError, "권한이 없습니다.");
  const count = h.views.length; h.change(); h.status("CLOSED"); await settle(); assert.equal(h.views.length, count);
  h.sync.dispose();
});
test("조회 실패는 상태를 지우고 재구독·온라인 조회 성공으로 복구된다", async () => {
  const h = setup(); await settle();
  h.access.read = async () => { throw new Error("조회 실패"); };
  await h.sync.refresh(); assert.equal(h.view.state, null); assert.equal(h.view.error, "조회 실패"); assert.equal(h.view.loading, false);
  h.access.read = async () => ({ role: "master", state }); h.status("SUBSCRIBED"); await settle();
  assert.equal(h.view.state, state); assert.equal(h.view.error, ""); h.sync.dispose();
});
test("로그아웃·룸 해제는 늦은 조회와 이벤트로 상태가 복원되지 않는다", async () => {
  const h = setup(); await settle();
  const old = deferred<Awaited<ReturnType<JukeboxAccess["read"]>>>(); h.access.read = () => old.promise;
  const pending = h.sync.refresh(); h.sync.leave();
  old.resolve({ role: "master", state }); await pending;
  assert.equal(h.view.state, null); assert.equal(h.closes, 1);
  h.sync.dispose(); const count = h.views.length;
  h.window.dispatchEvent(new Event("online")); h.document.dispatchEvent(new Event("visibilitychange")); h.change(); h.status("SUBSCRIBED");
  await h.sync.refresh(); await h.sync.control({ action: "play", musicAssetId: "m" }); await settle();
  assert.equal(h.views.length, count); assert.equal(h.commands.length, 0);
});
test("룸 변경 중 RPC 완료는 이전 룸을 다시 조회하거나 갱신하지 않는다", async () => {
  const h = setup(); await settle();
  const rpc = deferred<void>(); h.access.control = () => rpc.promise;
  const pending = h.sync.control({ action: "pause" }); h.sync.dispose();
  const count = h.views.length; const reads = h.reads; rpc.resolve(); await pending;
  assert.equal(h.views.length, count); assert.equal(h.reads, reads); assert.equal(h.closes, 1);
});

function clientStub() {
  const filters: unknown[][] = [];
  let member: unknown = { role: "master" };
  let row: unknown = state;
  let queryError: unknown = null;
  let rpcError: { code: string } | null = null;
  const rpcCalls: unknown[][] = [];
  const events: unknown[][] = [];
  let removed = 0;
  const channel = { on(...args: unknown[]) { events.push(args); return this; }, subscribe() { return this; } };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-a" } }, error: null }) },
    from(table: string) {
      const query = {
        select(fields: string) { filters.push([table, "select", fields]); return this; },
        eq(column: string, value: string) { filters.push([table, column, value]); return this; },
        maybeSingle: async () => ({ data: table === "room_members" ? member : row, error: queryError }),
      }; return query;
    },
    rpc: async (...args: unknown[]) => { rpcCalls.push(args); return { error: rpcError }; },
    channel: () => channel,
    removeChannel: async () => { removed++; },
  } as unknown as SupabaseClient;
  return { client, filters, rpcCalls, events, get removed() { return removed; },
    setMember(value: unknown) { member = value; }, setRow(value: unknown) { row = value; },
    failQuery() { queryError = {}; }, failRpc(code: string) { rpcError = { code }; } };
}
test("API는 현재 로그인 사용자의 활성 구성원 권한과 해당 룸 상태만 조회한다", async () => {
  const h = clientStub(); const api = jukeboxAccess(h.client, "room-a");
  assert.deepEqual(await api.read(), { state, role: "master" });
  assert.ok(h.filters.some((f) => f.join() === "room_members,user_id,user-a"));
  assert.ok(h.filters.some((f) => f.join() === "room_members,status,active"));
  assert.ok(h.filters.some((f) => f.join() === "room_jukebox_states,room_id,room-a"));
  h.setMember(null); assert.deepEqual(await api.read(), { state: null, role: null });
  h.setMember({ role: "spectator" }); h.setRow(null); assert.deepEqual(await api.read(), { role: "spectator", state: null });
  h.setRow({ ...state, room_id: "other-room" }); await assert.rejects(api.read());
  h.failQuery(); await assert.rejects(api.read());
});
test("API는 BE RPC·INSERT/UPDATE 룸 필터를 사용하고 구독을 제거한다", async () => {
  const h = clientStub(); const api = jukeboxAccess(h.client, "room-a");
  await api.control({ action: "set_loop", loopEnabled: false });
  assert.deepEqual(h.rpcCalls, [["control_room_jukebox", { target_room_id: "room-a", action: "set_loop", target_loop_enabled: false }]]);
  for (const code of ["42501", "23514", "22023", "unknown"]) {
    h.failRpc(code); await assert.rejects(api.control({ action: "stop" }));
  }
  const close = api.watch(() => {}, () => {});
  assert.deepEqual(h.events.map((entry) => entry[1]), ["INSERT", "UPDATE"].map((event) =>
    ({ event, schema: "public", table: "room_jukebox_states", filter: "room_id=eq.room-a" })));
  close(); assert.equal(h.removed, 1);
});


test("닫힌 채널은 제거하고 온라인 복구 때 새 채널을 구독한다", async () => {
  const h = setup(); await settle();
  h.status("CLOSED"); assert.equal(h.closes, 1); assert.match(h.view.connectionError, /실시간/);
  h.window.dispatchEvent(new Event("online")); await settle(); assert.equal(h.watches, 2);
  h.status("SUBSCRIBED"); await settle(); assert.equal(h.view.connectionError, ""); h.sync.dispose();
});
test("로그아웃 중 완료된 이전 RPC는 상태를 재조회하지 않는다", async () => {
  const h = setup(); await settle(); const rpc = deferred<void>(); h.access.control = () => rpc.promise;
  const pending = h.sync.control({ action: "pause" }); h.sync.leave();
  const count = h.views.length; const reads = h.reads; rpc.resolve(); await pending;
  assert.equal(h.views.length, count); assert.equal(h.reads, reads); assert.equal(h.view.state, null); h.sync.dispose();
});
