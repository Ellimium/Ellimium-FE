import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";
import { diceRollDisplay } from "./dice-log.ts";
import type { DiceRollLog } from "./dice-log.ts";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("dice-roll.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const settle = async () => { for (let i = 0; i < 600; i++) await Promise.resolve(); };
const notification = (id: string): DiceRollLog => ({ id, room_id: "room", roller_id: "roller", visibility: "private", created_at: "2026-10-07T00:00:00Z" });
const detail = (id: string): DiceRollLog => ({ ...notification(id), expression: "2d6", individual_results: [3, 4], total: 7 });
type Result = { data: DiceRollLog[] | null; error: { message: string } | null };
function deferred() {
  let resolve!: (result: Result) => void;
  const promise = new Promise<Result>((done) => { resolve = done; });
  return { promise, resolve };
}

type PageRequest = { table: string; limit: number; before: { created_at: string; id: string } | null; since: { created_at: string; id: string } | null };
function harness() {
  let phase = "connecting";
  let retry = () => {};
  const publish = (state: string, again: () => void) => { phase = state; retry = again; };
  const states: unknown[] = [];
  let index = 0;
  let refIndex = 0;
  const refs: { current: unknown }[] = [];
  let roomId = "room";
  let permissionError = "";
  let role: "master" | "player" | "spectator" | null = "master";
  let userId = "me";
  let effect!: () => () => void;
  let status!: (status: string) => void;
  let disposed!: () => void;
  let insert: Record<string, (payload: { new: DiceRollLog }) => void> = {};
  let read: (table: string, request: PageRequest) => Promise<Result> = async () => ({ data: [], error: null });
  const reads: PageRequest[] = [];
  let rpcRead: () => Promise<Result> = async () => ({ data: [], error: null });
  const channel = {
    on: (_event: string, filter: { table: string }, callback: typeof insert[string]) => { insert[filter.table] = callback; return channel; },
    subscribe: (callback: typeof status) => { status = callback; return channel; },
  };
  const client = {
    rpc: () => rpcRead(),
    channel: (_name: string, config: { config: { private: boolean; postgres_changes_options: { wait: boolean } } }) => { assert.equal(config.config.private, true); assert.equal(config.config.postgres_changes_options.wait, true); return channel; },
    removeChannel: async () => {},
    from: (table: string) => {
      const request: PageRequest = { table, limit: 0, before: null, since: null };
      const query = {
        select: () => query,
        eq: (field: string, value: string) => { assert.equal(field, "room_id"); assert.equal(value, roomId); return query; },
        order: () => query,
        limit: (limit: number) => { request.limit = limit; return query; },
        or: (filter: string) => {
          const upper = filter.match(/created_at.lt.([^,]+),and\(created_at.eq.([^,]+),id.lt.([^)]+)\)/);
          const lower = filter.match(/created_at.gt.([^,]+),and\(created_at.eq.([^,]+),id.gte.([^)]+)\)/);
          request.before = upper ? { created_at: upper[1], id: upper[3] } : null;
          request.since = lower ? { created_at: lower[1], id: lower[3] } : null;
          return query;
        },
        then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
          reads.push(request); return read(table, request).then(resolve, reject);
        },
        in: (_field: string, ids: string[]) => Promise.resolve({ data: ids.map((user_id) => ({ user_id, nickname: user_id })), error: null }),
      };
      return query;
    },
  };
  const exports: { default?: (props: { roomId: string }) => React.ReactNode } = {};
  runInNewContext(compiled, {
    exports, window: new EventTarget(), navigator: { onLine: true },
    require: (name: string) => {
      if (name === "react") return { ...React,
        useState: (initial: unknown) => {
          const i = index++;
          if (states.length <= i) states[i] = initial;
          return [states[i], (next: unknown) => { states[i] = typeof next === "function" ? next(states[i]) : next; }];
        },
        useRef: (current: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current }),
        useLayoutEffect: () => {},
        useMemo: (factory: () => unknown) => factory(),
        useEffect: (next: typeof effect) => { effect = next; },
      };
      if (name === "./room-connection") return { useRecordConnection: () => ({ state: phase, publish, retry }) };
      if (name === "./room-permissions") return { useRoomPermissions: () => ({ error: permissionError, role, currentUserId: userId, members: [], loading: false, canUse: () => true }) };
      if (name === "@/lib/supabase/client") return { supabase: client };
      return require(name.startsWith("./") ? `${name}.ts` : name);
    },
  });
  return {
    start(nextRole = role, nextUserId = userId, nextRoomId = roomId, error = "") {
      disposed?.(); role = nextRole; userId = nextUserId; index = refIndex = 0; roomId = nextRoomId; permissionError = error; insert = {};
      exports.default!({ roomId }); disposed = effect();
    },
    read(next: typeof read) { read = next; },
    status(next: string) { status(next); },
    insert(table: string, roll: DiceRollLog) { insert[table]({ new: roll }); },
    get callbacks() { return { status, insert }; },
    get rolls() { return states[1] as DiceRollLog[]; },
    get phase() { return phase; },
    retry() { retry(); },
    get error() { return states[11] as string; },
    dispose() { disposed?.(); },
    reads,
    rpcRead(next: typeof rpcRead) { rpcRead = next; },
    submit() {
      states[7] = "2d6"; index = refIndex = 0;
      type Props = { children?: React.ReactNode; onSubmit?: (event: { preventDefault: () => void }) => Promise<void> };
      function find(node: React.ReactNode): React.ReactElement<Props> | undefined {
        if (Array.isArray(node)) return node.map(find).find(Boolean);
        if (!React.isValidElement<Props>(node)) return;
        return node.type === "form" ? node : find(node.props.children);
      }
      return find(exports.default!({ roomId }))!.props.onSubmit!({ preventDefault() {} });
    },
    loadOlder: () => (refs[2].current as () => Promise<void>)(),
    get hasOlder() { return states[12]; },
    get loadingOlder() { return states[13]; },
    get olderError() { return states[14]; },
    get rollerNames() { return states[2] as Record<string, string>; },
    dataset(details: DiceRollLog[], notifications: DiceRollLog[]) {
      read = async (table, { limit, before, since }) => ({ data: (table === "dice_rolls" ? details : notifications)
        .filter((m) => (!before || m.created_at < before.created_at || m.created_at === before.created_at && m.id < before.id)
          && (!since || m.created_at > since.created_at || m.created_at === since.created_at && m.id >= since.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, limit), error: null });
    },
  };
}

test("재구독은 양쪽 기록을 조회하고 동시 상세·알림·중복 INSERT를 손실 없이 병합한다", async () => {
  const h = harness();
  h.read(async (table) => ({ data: table === "dice_rolls" ? [detail("before")] : [notification("before")], error: null }));
  h.start(); await settle();
  for (const failure of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) {
    h.status(failure);
    const pending = deferred();
    h.read(() => pending.promise); const count = h.reads.length;
    h.status("SUBSCRIBED"); await settle(); assert.equal(h.reads.length, count + 2);
    assert.equal(h.rolls.length, 1);
    h.insert("dice_rolls", detail("live"));
    h.insert("dice_roll_notifications", notification("live"));
    h.insert("dice_rolls", detail("live"));
    pending.resolve({ data: [notification("before"), notification("missed")], error: null }); await settle();
    assert.deepEqual(h.rolls.map(({ id }) => id).sort(), ["before", "live", "missed"]);
    assert.equal(h.rolls.find(({ id }) => id === "live")!.total, 7);
    // Reset the baseline before the next reconnect scenario.
    h.read(async () => ({ data: [detail("before")], error: null })); h.start("master", `baseline-${failure}`); await settle();
  }
  h.dispose();
});

test("양쪽 테이블의 동일 시각 1,102건을 최신 100건부터 누락·중복 없이 탐색한다", async () => {
  const h = harness();
  const records = Array.from({ length: 1102 }, (_, i) => detail(String(i).padStart(4, "0")));
  h.dataset(records, records.map((r) => notification(r.id)));
  h.start(); await settle();
  assert.equal(h.rolls.length, 100); assert.equal(h.hasOlder, true);
  assert.equal(h.rolls[0].id, "1101");
  h.status("SUBSCRIBED"); await settle(); assert.equal(h.rolls.length, 100);
  for (let i = 0; i < 11; i++) await h.loadOlder();
  assert.equal(h.rolls.length, 1102); assert.equal(h.hasOlder, false);
  assert.equal(new Set(h.rolls.map(({ id }) => id)).size, 1102);
  assert.ok(h.rolls.every((r) => r.total === 7));
  h.dispose();
});

test("공개 상세와 다른 사용자의 비공개 알림을 합친 최신 100건만 먼저 보이고 공통 커서로 이어 읽는다", async () => {
  const h = harness();
  const details = Array.from({ length: 100 }, (_, i) => ({ ...detail(String(i).padStart(4, "0")), visibility: "public" as const }));
  const notifications = Array.from({ length: 100 }, (_, i) => notification(String(i + 100).padStart(4, "0")));
  h.dataset(details, notifications); h.start("player", "other"); await settle();
  assert.equal(h.rolls.length, 100); assert.ok(h.rolls.every((r) => r.expression === undefined));
  assert.equal(h.rolls[0].id, "0199");
  await h.loadOlder(); assert.equal(h.rolls.length, 200);
  assert.equal(h.rolls.filter((r) => r.total === 7).length, 100);
  assert.deepEqual(h.reads.slice(-2).map((r) => r.before?.id), ["0100", "0100"]);
  await h.loadOlder(); assert.equal(h.hasOlder, false); h.dispose();
});

test("재연결은 한 페이지보다 긴 누락 구간을 상세·알림 중복 없이 복구한다", async () => {
  const h = harness();
  const records = Array.from({ length: 1202 }, (_, i) => ({ ...detail(String(i).padStart(4, "0")), created_at: new Date(Date.UTC(2026, 9, 7, 0, 0, i)).toISOString() }));
  h.dataset(records.slice(0, 100), records.slice(0, 100).map(({ expression, total, individual_results, ...r }) => r));
  h.start(); await settle();
  h.dataset(records, records.map(({ expression, total, individual_results, ...r }) => r));
  h.insert("dice_rolls", records.at(-1)!); h.status("SUBSCRIBED"); await settle();
  assert.equal(h.rolls.length, 1202); assert.equal(new Set(h.rolls.map(({ id }) => id)).size, 1202);
  assert.ok(h.rolls.every((r) => r.total === 7)); h.dispose();
});

test("한 테이블 실패 시 기록·커서를 유지해 재시도하고 중복 클릭과 동시 수신을 처리한다", async () => {
  const h = harness();
  const records = Array.from({ length: 201 }, (_, i) => detail(String(i).padStart(4, "0")));
  h.dataset(records, records.map((r) => notification(r.id))); h.start(); await settle();
  h.read(async (table) => table === "dice_rolls" ? { data: records.slice(1, 101), error: null } : { data: null, error: { message: "network" } });
  await h.loadOlder(); assert.equal(h.rolls.length, 100); assert.ok(h.olderError);
  const cursor = h.reads.at(-1)!.before;
  const pending = deferred(); h.read(() => pending.promise); const loading = h.loadOlder(); await settle();
  const count = h.reads.length; await h.loadOlder(); assert.equal(h.reads.length, count); assert.equal(h.loadingOlder, true);
  h.insert("dice_rolls", detail("live")); h.insert("dice_roll_notifications", notification("live"));
  pending.resolve({ data: records.slice(1, 101).reverse(), error: null }); await loading;
  assert.deepEqual(h.reads.at(-1)!.before, cursor); assert.equal(h.olderError, "");
  assert.equal(h.rolls.length, 201); assert.equal(h.rolls.find((r) => r.id === "live")!.total, 7);
  h.dataset(records, records.map((r) => notification(r.id))); await h.loadOlder();
  assert.equal(h.rolls.length, 202); assert.equal(h.hasOlder, false); h.dispose();
});

test("이전 페이지 조회 중 역할·계정·룸 변경과 접근 소실은 늦은 상세를 폐기한다", async () => {
  for (const [role, userId, roomId] of [["spectator", "other", "room"], ["player", "another", "room"], ["master", "me", "another-room"], [null, "me", "room"]] as const) {
    const h = harness(); const records = Array.from({ length: 101 }, (_, i) => detail(String(i).padStart(4, "0")));
    h.dataset(records, records.map((r) => notification(r.id))); h.start(); await settle();
    const pending = deferred(); h.read(() => pending.promise); const loading = h.loadOlder(); await settle();
    h.read(async (table) => ({ data: table === "dice_roll_notifications" ? [notification("new")] : [], error: null }));
    h.start(role, userId, roomId); await settle();
    pending.resolve({ data: [detail("stale-secret")], error: null }); await loading;
    assert.ok(!h.rolls.some((r) => r.id === "stale-secret")); assert.equal(h.hasOlder, false); assert.equal(h.loadingOlder, false);
    if (role) assert.equal(h.rolls[0].total, undefined);
    else assert.equal(h.rolls.length, 0);
    h.dispose();
  }
});

test("RLS로 받은 역할별 비공개 기록을 유지하고 강등 시 이전 상세·늦은 응답을 폐기한다", async () => {
  const h = harness();
  for (const [role, userId, canReadDetail] of [["master", "me", true], ["player", "roller", true], ["player", "other", false], ["spectator", "other", false]] as const) {
    h.read(async (table) => ({ data: table === "dice_roll_notifications" ? [notification("private")] : canReadDetail ? [detail("private")] : [], error: null }));
    h.start(role, userId); assert.equal(h.rolls.length, 0); await settle();
    h.status("SUBSCRIBED"); await settle();
    assert.equal(h.rolls.length, 1);
    assert.equal(diceRollDisplay(h.rolls[0]).total, canReadDetail ? "7" : "?");
  }
  const pending = deferred(); h.read(() => pending.promise); h.start("master"); await settle();
  const old = h.callbacks;
  h.read(async (table) => ({ data: table === "dice_roll_notifications" ? [notification("private")] : [], error: null }));
  h.start("spectator"); await settle();
  pending.resolve({ data: [detail("private")], error: null });
  old.insert.dice_rolls({ new: detail("private") }); old.status("SUBSCRIBED"); await settle();
  assert.equal(diceRollDisplay(h.rolls[0]).total, "?");
  h.dispose();
});

test("느린 이전 조회·종료 후 이벤트는 무시하고 실패한 조회는 다음 구독에서 복구한다", async () => {
  const h = harness(); const pending = deferred();
  h.read(() => pending.promise); h.start(); await settle();
  h.read(async () => ({ data: [detail("latest")], error: null })); h.status("SUBSCRIBED"); await settle();
  pending.resolve({ data: [detail("stale")], error: null }); await settle();
  assert.deepEqual(h.rolls.map(({ id }) => id), ["latest"]);
  h.read(async () => { throw new Error("offline"); }); h.status("SUBSCRIBED"); await settle();
  assert.ok(h.error); assert.equal(h.rolls.length, 1);
  h.read(async () => ({ data: [detail("recovered")], error: null })); h.status("SUBSCRIBED"); await settle();
  assert.equal(h.error, ""); assert.equal(h.rolls.length, 2);
  h.dispose(); const count = h.reads.length;
  h.status("SUBSCRIBED"); h.insert("dice_rolls", detail("late"));
  assert.equal(h.reads.length, count); assert.equal(h.rolls.length, 2);
});

test("주사위 패널은 구독 후 동기화 완료·실패·재시도 결과를 헤더에 전달한다", async () => {
  const h = harness(); h.start(); await settle(); assert.equal(h.phase, "connecting");
  h.status("SUBSCRIBED"); assert.equal(h.phase, "syncing"); await settle(); assert.equal(h.phase, "ready");
  h.read(async () => ({ data: null, error: { message: "failed" } })); h.retry(); await settle(); assert.equal(h.phase, "error");
  h.read(async () => ({ data: [detail("recovered")], error: null })); h.retry(); await settle();
  assert.equal(h.phase, "ready"); assert.equal(h.rolls[0].total, 7); h.dispose();
});

test("주사위 DB 구독 준비 전 상세·알림을 복구하고 이후 INSERT와 중복 없이 합친다", async () => {
  const h = harness(); h.read(async () => ({ data: [], error: null }));
  h.start(); await settle(); assert.equal(h.phase, "connecting");
  h.read(async (table) => ({ data: table === "dice_rolls" ? [detail("during-join")] : [notification("during-join")], error: null }));
  assert.equal(h.phase, "connecting"); h.status("SUBSCRIBED");
  h.insert("dice_rolls", detail("after-ready"));
  h.insert("dice_roll_notifications", notification("after-ready"));
  h.insert("dice_roll_notifications", notification("during-join"));
  await settle();
  assert.equal(h.phase, "ready");
  assert.deepEqual(h.rolls.map(({ id }) => id).sort(), ["after-ready", "during-join"]);
  assert.ok(h.rolls.every((roll) => roll.total === 7)); h.dispose();
});


test("주사위 굴림 RPC도 역할 변경 뒤 늦게 도착한 비공개 상세를 폐기한다", async () => {
  const h = harness(); h.dataset([], []); h.start("master"); await settle();
  const pending = deferred(); h.rpcRead(() => pending.promise); const request = h.submit();
  h.read(async (table) => ({ data: table === "dice_roll_notifications" ? [notification("private")] : [], error: null }));
  h.start("spectator", "other"); await settle();
  pending.resolve({ data: [detail("private")], error: null }); await request;
  assert.equal(h.rolls.length, 1); assert.equal(h.rolls[0].total, undefined); h.dispose();
});

test("빈 룸 이후 한 페이지보다 많은 기록이 쌓여도 재연결로 모두 복구한다", async () => {
  const h = harness(); h.dataset([], []); h.start(); await settle();
  const records = Array.from({ length: 201 }, (_, i) => detail(String(i).padStart(4, "0")));
  h.dataset(records, records.map((r) => notification(r.id))); h.status("SUBSCRIBED"); await settle();
  assert.equal(h.rolls.length, 201); assert.equal(h.hasOlder, false); h.dispose();
});


test("일시적인 권한 확인 실패 후 같은 역할로 복귀하면 기존 커서부터 복구하고 실제 역할 변경은 초기화한다", async () => {
  const h = harness();
  const records = Array.from({ length: 1002 }, (_, i) => ({ ...detail(String(i).padStart(4, "0")), created_at: new Date(Date.UTC(2026, 9, 7, 0, 0, i)).toISOString() }));
  h.dataset(records, []); h.start(); await settle(); await h.loadOlder(); assert.equal(h.rolls.length, 200);
  h.start(null, "me", "room", "offline"); assert.equal(h.rolls.length, 200); assert.equal(h.hasOlder, true);
  const missed = Array.from({ length: 205 }, (_, i) => ({ ...detail(String(i + 1002).padStart(4, "0")), created_at: new Date(Date.UTC(2026, 9, 7, 0, 0, i + 1002)).toISOString() }));
  h.dataset([...records, ...missed], []); h.start("master"); await settle();
  assert.equal(h.rolls.length, 405); assert.ok(h.rolls.some((r) => r.id === "0802"));
  h.dataset([], [notification("private")]); h.start("spectator"); await settle();
  assert.equal(h.rolls.length, 1); assert.equal(h.rolls[0].total, undefined); h.dispose();
});


test("추가 조회 중 권한 확인 단절은 로딩을 해제하고 늦은 상세를 버린 뒤 재조회할 수 있다", async () => {
  const h = harness(); const rows = Array.from({ length: 201 }, (_, i) => detail(String(i).padStart(4, "0")));
  h.dataset(rows, []); h.start(); await settle();
  const pending = deferred(); h.read(() => pending.promise); const loading = h.loadOlder(); await settle();
  assert.equal(h.loadingOlder, true); h.start(null, "me", "room", "offline"); assert.equal(h.loadingOlder, false);
  pending.resolve({ data: rows.slice(0, 101), error: null }); await loading; assert.equal(h.rolls.length, 100);
  h.dataset(rows, []); h.start("master"); await settle(); await h.loadOlder();
  assert.equal(h.rolls.length, 200); assert.equal(h.loadingOlder, false); h.dispose();
});
