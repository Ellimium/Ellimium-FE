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
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const notification = (id: string): DiceRollLog => ({ id, room_id: "room", roller_id: "roller", visibility: "private", created_at: "2026-10-07T00:00:00Z" });
const detail = (id: string): DiceRollLog => ({ ...notification(id), expression: "2d6", individual_results: [3, 4], total: 7 });
type Result = { data: DiceRollLog[] | null; error: { message: string } | null };
function deferred() {
  let resolve!: (result: Result) => void;
  const promise = new Promise<Result>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const states: unknown[] = [];
  let index = 0;
  let role: "master" | "player" | "spectator" = "master";
  let userId = "me";
  let effect!: () => () => void;
  let status!: (status: string) => void;
  let disposed!: () => void;
  let insert: Record<string, (payload: { new: DiceRollLog }) => void> = {};
  let read: (table: string, offset: number, end: number) => Promise<Result> = async () => ({ data: [], error: null });
  const reads: { table: string; offset: number; end: number }[] = [];
  const channel = {
    on: (_event: string, filter: { table: string }, callback: typeof insert[string]) => { insert[filter.table] = callback; return channel; },
    subscribe: (callback: typeof status) => { status = callback; return channel; },
  };
  const client = {
    channel: (_name: string, config: { config: { private: boolean } }) => { assert.equal(config.config.private, true); return channel; },
    removeChannel: async () => {},
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: (field: string, value: string) => { assert.equal(field, "room_id"); assert.equal(value, "room"); return query; },
        order: () => query,
        range: (offset: number, end: number) => { reads.push({ table, offset, end }); return read(table, offset, end); },
        in: (_field: string, ids: string[]) => Promise.resolve({ data: ids.map((user_id) => ({ user_id, nickname: user_id })), error: null }),
      };
      return query;
    },
  };
  const exports: { default?: React.FunctionComponent<{ roomId: string }> } = {};
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === "react") return { ...React,
        useState: (initial: unknown) => {
          const i = index++;
          if (states.length <= i) states[i] = initial;
          return [states[i], (next: unknown) => { states[i] = typeof next === "function" ? next(states[i]) : next; }];
        },
        useMemo: (factory: () => unknown) => factory(),
        useEffect: (next: typeof effect) => { effect = next; },
      };
      if (name === "./room-permissions") return { useRoomPermissions: () => ({ role, currentUserId: userId, members: [], loading: false, canUse: () => true }) };
      if (name === "@/lib/supabase/client") return { supabase: client };
      return require(name.startsWith("./") ? `${name}.ts` : name);
    },
  });
  return {
    start(nextRole = role, nextUserId = userId) {
      disposed?.(); role = nextRole; userId = nextUserId; index = 0; insert = {};
      exports.default!({ roomId: "room" }); disposed = effect();
    },
    read(next: typeof read) { read = next; },
    status(next: string) { status(next); },
    insert(table: string, roll: DiceRollLog) { insert[table]({ new: roll }); },
    get callbacks() { return { status, insert }; },
    get rolls() { return states[1] as DiceRollLog[]; },
    get error() { return states[11] as string; },
    dispose() { disposed(); },
    reads,
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
    h.status("SUBSCRIBED"); assert.equal(h.reads.length, count + 2);
    assert.equal(h.rolls.length, 1);
    h.insert("dice_rolls", detail("live"));
    h.insert("dice_roll_notifications", notification("live"));
    h.insert("dice_rolls", detail("live"));
    pending.resolve({ data: [notification("before"), notification("missed")], error: null }); await settle();
    assert.deepEqual(h.rolls.map(({ id }) => id).sort(), ["before", "live", "missed"]);
    assert.equal(h.rolls.find(({ id }) => id === "live")!.total, 7);
    // Reset the baseline before the next reconnect scenario.
    h.read(async () => ({ data: [detail("before")], error: null })); h.start(); await settle();
  }
  h.dispose();
});

test("두 테이블의 1,000행 초과 기록을 마지막 페이지까지 읽는다", async () => {
  const h = harness();
  const records = Array.from({ length: 1002 }, (_, i) => detail(String(i)));
  h.read(async (_table, offset, end) => ({ data: records.slice(offset, end + 1), error: null }));
  h.start(); await settle();
  assert.equal(h.rolls.length, 1002);
  for (const table of ["dice_rolls", "dice_roll_notifications"]) {
    assert.deepEqual(h.reads.filter((read) => read.table === table).map(({ offset, end }) => [offset, end]), [[0, 999], [1000, 1999]]);
  }
  h.dispose();
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
  const pending = deferred(); h.read(() => pending.promise); h.start("master");
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
  h.read(() => pending.promise); h.start();
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
