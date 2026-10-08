import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";
import type { ChatMessage } from "./chat-message.ts";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("chat.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const message = (id: string, second = 0): ChatMessage => ({
  id, room_id: "room", sender_id: "sender", character_id: null, character_name: null,
  mode: "general", content: id, message_type: "chat", event_type: null, event_data: null,
  created_at: new Date(Date.UTC(2026, 9, 7, 0, 0, second)).toISOString(),
});
type Result = { data: ChatMessage[] | null; error: { message: string } | null };
function deferred() {
  let resolve!: (result: Result) => void;
  const promise = new Promise<Result>((done) => { resolve = done; });
  return { promise, resolve };
}

// Exercise the component's actual query/subscription callbacks with deferred API responses.
function harness() {
  let phase = "connecting";
  let retry = () => {};
  const publish = (state: string, again: () => void) => { phase = state; retry = again; };
  const states: unknown[] = [];
  const effects: (() => void | (() => void))[] = [];
  let stateIndex = 0;
  let status!: (value: string) => void;
  let insert!: (payload: { new: ChatMessage }) => void;
  let read: (offset: number, end: number) => Promise<Result> = async () => ({ data: [], error: null });
  let reads = 0;
  let removed = false;
  const ranges: number[][] = [];
  const profileIds: string[][] = [];
  const channel = {
    on: (_event: string, _filter: unknown, callback: typeof insert) => { insert = callback; return channel; },
    subscribe: (callback: typeof status) => { status = callback; return channel; },
  };
  const client = {
    channel: (_name: string, options: { config: { postgres_changes_options: { wait: boolean } } }) => {
      assert.equal(options.config.postgres_changes_options.wait, true);
      return channel;
    },
    removeChannel: async () => { removed = true; },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range: (offset: number, end: number) => { reads++; ranges.push([offset, end]); return read(offset, end); },
        in: (_field: string, ids: string[]) => {
          profileIds.push(ids);
          return Promise.resolve({ data: ids.map((user_id) => ({ user_id, nickname: user_id })), error: null });
        },
        maybeSingle: async () => ({ data: { user_id: "sender", nickname: "sender" }, error: null }),
        then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      assert.ok(["chat_messages", "character_sheets", "profiles"].includes(table));
      return query;
    },
  };
  const exports: { default?: React.FunctionComponent<{ roomId: string }> } = {};
  runInNewContext(compiled, {
    exports, window: new EventTarget(), navigator: { onLine: true },
    require: (name: string) => {
      if (name === "react") return { ...React,
        useState: (initial: unknown) => {
          const index = stateIndex++;
          states[index] = initial;
          return [initial, (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
        },
        useRef: (current: unknown) => ({ current }),
        useEffect: (effect: typeof effects[number]) => effects.push(effect),
        useLayoutEffect: () => {},
      };
      if (name === "./room-connection") return { useRecordConnection: () => ({ state: phase, publish, retry }) };
      if (name === "./room-permissions") return { useRoomPermissions: () => ({
        role: "player", currentUserId: "me", members: [{ user_id: "me" }], loading: false, canUse: () => true,
      }) };
      if (name === "@/lib/supabase/client") return { supabase: client };
      return require(name.startsWith("./") ? `${name}.ts` : name);
    },
  });
  exports.default!({ roomId: "room" });
  return {
    start: () => effects[0]() as () => void,
    read: (next: typeof read) => { read = next; },
    status: (next: string) => status(next),
    insert: (next: ChatMessage) => insert({ new: next }),
    get messages() { return states[1] as ChatMessage[]; },
    get phase() { return phase; },
    retry() { retry(); },
    get error() { return states[10] as string; },
    get reads() { return reads; },
    get removed() { return removed; },
    ranges, profileIds,
  };
}

test("초기 구독과 재구독은 누락 기록을 조회하고 동시 INSERT·중복을 시간순으로 병합한다", async () => {
  const h = harness();
  h.read(async () => ({ data: [message("before")], error: null }));
  const dispose = h.start();
  await settle();
  for (const failure of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) {
    h.status(failure);
    const pending = deferred();
    h.read(() => pending.promise);
    const before = h.reads;
    h.status("SUBSCRIBED");
    assert.equal(h.reads, before + 1);
    assert.ok(h.messages.some(({ id }) => id === "before"));
    h.insert(message("live", 2)); h.insert(message("live", 2));
    pending.resolve({ data: [message("before"), message("missed", 1), message("live", 2)], error: null });
    await settle();
    assert.deepEqual(h.messages.map(({ id }) => id), ["before", "missed", "live"]);
    assert.ok(h.profileIds.at(-1)!.includes("sender"));
  }
  dispose();
});

test("구독 완료 전 조회가 끝나도 SUBSCRIBED 후 다시 조회해 초기 틈의 기록을 복구한다", async () => {
  const h = harness();
  h.read(async () => ({ data: [message("before")], error: null }));
  const dispose = h.start(); await settle();
  h.read(async () => ({ data: [message("before"), message("gap", 1)], error: null }));
  h.status("SUBSCRIBED"); await settle();
  assert.deepEqual(h.messages.map(({ id }) => id), ["before", "gap"]);
  dispose();
});

test("1,000행 제한을 넘는 기록도 마지막 페이지까지 조회한다", async () => {
  const h = harness();
  const messages = Array.from({ length: 1002 }, (_, i) => message(String(i).padStart(4, "0"), i));
  h.read(async (offset, end) => ({ data: messages.slice(offset, end + 1), error: null }));
  const dispose = h.start(); await settle();
  assert.equal(h.messages.length, 1002);
  assert.deepEqual(h.ranges, [[0, 999], [1000, 1999]]);
  dispose();
});

test("늦은 이전 동기화 응답은 새 조회를 덮어쓰지 않고 종료 후 응답·이벤트를 무시한다", async () => {
  const h = harness(); const old = deferred();
  h.read(() => old.promise);
  const dispose = h.start();
  h.read(async () => ({ data: [message("latest")], error: null }));
  h.status("SUBSCRIBED"); await settle();
  old.resolve({ data: [message("stale")], error: null }); await settle();
  assert.deepEqual(h.messages.map(({ id }) => id), ["latest"]);
  const pending = deferred(); h.read(() => pending.promise); h.status("SUBSCRIBED");
  dispose(); const reads = h.reads;
  h.status("SUBSCRIBED"); h.insert(message("after-dispose"));
  pending.resolve({ data: [message("after-dispose")], error: null }); await settle();
  assert.equal(h.reads, reads); assert.equal(h.removed, true);
  assert.deepEqual(h.messages.map(({ id }) => id), ["latest"]);
});

test("페이지 조회 실패는 기존 기록을 유지하고 다음 구독에서 복구한다", async () => {
  const h = harness();
  h.read(async () => ({ data: [message("before")], error: null }));
  const dispose = h.start(); await settle();
  h.read(async () => ({ data: null, error: { message: "network" } }));
  h.status("SUBSCRIBED"); await settle();
  assert.ok(h.error); assert.deepEqual(h.messages.map(({ id }) => id), ["before"]);
  h.read(async () => ({ data: [message("before"), message("recovered", 1)], error: null }));
  h.status("SUBSCRIBED"); await settle();
  assert.equal(h.error, ""); assert.deepEqual(h.messages.map(({ id }) => id), ["before", "recovered"]);
  dispose();
});

test("채팅 패널은 구독 후 동기화 완료·실패·재시도 결과를 헤더에 전달한다", async () => {
  const h = harness(); const dispose = h.start(); await settle();
  assert.equal(h.phase, "connecting");
  h.status("SUBSCRIBED"); assert.equal(h.phase, "syncing"); await settle(); assert.equal(h.phase, "ready");
  h.read(async () => ({ data: null, error: { message: "failed" } })); h.retry(); await settle(); assert.equal(h.phase, "error");
  h.read(async () => ({ data: [message("recovered")], error: null })); h.retry(); await settle();
  assert.equal(h.phase, "ready"); assert.equal(h.messages[0].id, "recovered"); dispose();
});

test("채팅 DB 구독 준비 전 기록은 준비 후 조회로 복구하고 이후 INSERT와 중복 없이 합친다", async () => {
  const h = harness(); h.read(async () => ({ data: [message("before")], error: null }));
  const dispose = h.start(); await settle(); assert.equal(h.phase, "connecting");
  // With wait: true, the SDK defers SUBSCRIBED until the DB stream is ready.
  h.read(async () => ({ data: [message("before"), message("during-join", 1)], error: null }));
  assert.equal(h.phase, "connecting"); h.status("SUBSCRIBED");
  h.insert(message("after-ready", 2)); h.insert(message("during-join", 1));
  await settle();
  assert.equal(h.phase, "ready");
  assert.deepEqual(h.messages.map(({ id }) => id), ["before", "during-join", "after-ready"]);
  dispose();
});
