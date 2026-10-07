import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { startRoomMembershipSync, type RoomMembershipView, type RoomMember } from "./room-membership.ts";
import { resolveRoomFeatureState } from "./room-permission.ts";

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness() {
  let members: RoomMember[] = [{ user_id: "me", role: "master" }, { user_id: "other", role: "spectator" }];
  let failure = false;
  let readOverride: ((table: string) => Promise<{ data: RoomMember[]; error: null }>) | undefined;
  let failedTable: string | undefined;
  let reads = 0;
  let removed = false;
  let change = () => {};
  let status = (_status: string) => {};
  const browser = { window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState: "visible" }) };
  let view: RoomMembershipView;
  const channel = {
    on(_event: string, _filter: unknown, callback: () => void) { change = callback; return this; },
    subscribe(callback: (value: string) => void) { status = callback; return this; },
  };
  let auth = async () => ({ data: { user: { id: "me" } }, error: null });
  const client = {
    auth: { getUser: () => { reads++; return auth(); } },
    from(table: string) {
      const result = { data: table === "room_members" ? members : [], error: failure && (!failedTable || failedTable === table) ? { message: "failed" } : null };
      const promise = readOverride?.(table) ?? Promise.resolve(result);
      const query = { select() { return this; }, eq() { return this; }, order() { return promise; }, then: promise.then.bind(promise) };
      return query;
    },
    channel: () => channel,
    removeChannel: async () => { removed = true; },
  } as unknown as SupabaseClient;
  const sync = startRoomMembershipSync(client, "room", (next) => { view = next; }, browser);
  return {
    sync, browser, get view() { return view!; }, get reads() { return reads; }, get removed() { return removed; },
    members(value: RoomMember[]) { members = value; }, fail(value: boolean, table?: string) { failure = value; failedTable = table; },
    read(value?: typeof readOverride) { readOverride = value; },
    auth(value: typeof auth) { auth = value; }, change: () => change(), status: (value: string) => status(value),
  };
}

test("주기적 조회로 역할과 참가자 목록을 함께 갱신하고 자신의 퇴장을 확인한다", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const h = harness(); t.after(h.sync.dispose);
  await settle(); assert.equal(h.view.role, "master");
  h.members([{ user_id: "me", role: "player" }, { user_id: "other", role: "player" }]);
  t.mock.timers.tick(5000); assert.equal(h.view.checking, true);
  await settle(); assert.equal(h.view.role, "player"); assert.equal(h.view.members[1].role, "player");
  h.members([{ user_id: "other", role: "player" }]);
  t.mock.timers.tick(5000); await settle();
  assert.equal(h.view.role, null); assert.deepEqual(h.view.members, []); assert.deepEqual(h.view.rows, []);
});

test("재조회 실패와 오프라인은 이전 권한을 제거하고 재연결 시 복구한다", async (t) => {
  const h = harness(); t.after(h.sync.dispose); await settle();
  h.fail(true); await h.sync.refresh();
  assert.equal(h.view.role, null); assert.ok(h.view.error); assert.equal(h.view.checking, false);
  h.fail(false); h.browser.window.dispatchEvent(new Event("online")); await settle();
  assert.equal(h.view.role, "master"); assert.equal(h.view.error, "");
  h.browser.window.dispatchEvent(new Event("offline")); assert.equal(h.view.role, null);
  h.status("SUBSCRIBED"); await settle(); assert.equal(h.view.role, "master");
  h.status("CHANNEL_ERROR"); assert.equal(h.view.role, null);
  h.change(); await settle(); assert.equal(h.view.role, "master");
});

test("숨긴 화면은 polling을 멈추고 복귀 시 조회하며 종료 후 이벤트와 늦은 응답을 무시한다", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const h = harness(); t.after(h.sync.dispose); await settle();
  const reads = h.reads;
  h.browser.document.visibilityState = "hidden"; t.mock.timers.tick(5000); assert.equal(h.reads, reads);
  h.browser.document.visibilityState = "visible"; h.browser.document.dispatchEvent(new Event("visibilitychange"));
  await settle(); assert.equal(h.reads, reads + 1);
  let complete!: (value: { data: { user: { id: string } }; error: null }) => void;
  h.auth(() => new Promise((resolve) => { complete = resolve; }));
  const oldRead = h.sync.refresh();
  h.auth(async () => ({ data: { user: { id: "me" } }, error: null }));
  h.members([{ user_id: "me", role: "spectator" }]); await h.sync.refresh();
  complete({ data: { user: { id: "me" } }, error: null }); await oldRead;
  assert.equal(h.view.role, "spectator");
  const published = h.view; h.sync.dispose();
  h.status("SUBSCRIBED"); h.change(); h.browser.window.dispatchEvent(new Event("online")); t.mock.timers.tick(5000);
  await settle(); assert.equal(h.view, published); assert.equal(h.removed, true);
});

test("권한 확인 중에는 조작을 거부하면서 기존 맵의 읽기 권한은 유지한다", () => {
  const checking = resolveRoomFeatureState("master", "me", [], true);
  assert.deepEqual(checking, { chat: false, map_view: true, dice: false, token_move: false, drawing: false });
  assert.equal(resolveRoomFeatureState(null, "me", [], true).map_view, false);
});


test("권한 설정 조회만 실패해도 멤버십 역할과 이전 조작 권한을 유지하지 않는다", async (t) => {
  const h = harness(); t.after(h.sync.dispose); await settle();
  h.fail(true, "room_feature_permissions"); await h.sync.refresh();
  assert.equal(h.view.role, null); assert.deepEqual(h.view.rows, []); assert.deepEqual(h.view.members, []);
  assert.ok(h.view.error); assert.equal(h.view.checking, false);
  h.fail(false); await h.sync.refresh(); assert.equal(h.view.role, "master"); assert.equal(h.view.error, "");
});

test("늦게 도착한 DB 승격 응답이 이후 확인된 퇴장을 덮어쓰지 않는다", async (t) => {
  const h = harness(); t.after(h.sync.dispose); await settle();
  let finish!: (result: { data: RoomMember[]; error: null }) => void;
  h.read((table) => table === "room_members" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ data: [], error: null }));
  const pending = h.sync.refresh(); await settle();
  h.read(); h.members([]); await h.sync.refresh();
  assert.equal(h.view.role, null); assert.equal(h.view.error, "");
  finish({ data: [{ user_id: "me", role: "master" }], error: null }); await pending;
  assert.equal(h.view.role, null); assert.deepEqual(h.view.members, []);
});

test("Auth 요청 예외 뒤에도 checking이 종료되고 다음 조회로 복구한다", async (t) => {
  const h = harness(); t.after(h.sync.dispose); await settle();
  h.auth(async () => { throw new Error("network failure"); }); await h.sync.refresh();
  assert.equal(h.view.role, null); assert.equal(h.view.checking, false); assert.ok(h.view.error);
  h.auth(async () => ({ data: { user: { id: "me" } }, error: null })); await h.sync.refresh();
  assert.equal(h.view.role, "master"); assert.equal(h.view.error, "");
});
