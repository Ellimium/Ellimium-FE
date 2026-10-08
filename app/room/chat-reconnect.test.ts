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
const settle = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };
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
type PageRequest = { limit: number; before: string | null; since: string | null; sinceId: string | null };
function harness() {
  let phase = "connecting";
  let retry = () => {};
  const publish = (state: string, again: () => void) => { phase = state; retry = again; };
  const states: unknown[] = [];
  const effects: (() => void | (() => void))[] = [];
  const effectDependencies: unknown[][] = [];
  const disposers: (void | (() => void))[] = [];
  const refs: { current: unknown }[] = [];
  let pendingEffects: number[] = [];
  let effectIndex = 0;
  let refIndex = 0;
  let permissions = {
    role: "player" as string | null, currentUserId: "me", members: [{ user_id: "me" }], loading: false, canUse: () => true,
  };
  let stateIndex = 0;
  let status!: (value: string) => void;
  let insert!: (payload: { new: ChatMessage }) => void;
  let read: (request: PageRequest) => Promise<Result> = async () => ({ data: [], error: null });
  let reads = 0;
  let removed = false;
  const requests: PageRequest[] = [];
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
      let profileId = "sender";
      const request: PageRequest = { limit: 0, before: null, since: null, sinceId: null };
      const query = {
        select: () => query,
        eq: (field: string, value: string) => { if (field === "user_id") profileId = value; return query; },
        order: () => query,
        limit: (limit: number) => { request.limit = limit; return query; },
        or: (filter: string) => {
          const upper = filter.match(/created_at.lt.([^,]+),and\(created_at.eq.([^,]+),id.lt.([^)]+)\)/);
          const lower = filter.match(/created_at.gt.([^,]+),and\(created_at.eq.([^,]+),id.gte.([^)]+)\)/);
          request.before = upper?.[0] ?? null;
          request.since = lower?.[1] ?? null;
          request.sinceId = lower?.[3] ?? null;
          return query;
        },
        in: (_field: string, ids: string[]) => {
          profileIds.push(ids);
          return Promise.resolve({ data: ids.map((user_id) => ({ user_id, nickname: user_id })), error: null });
        },
        maybeSingle: async () => ({ data: { user_id: profileId, nickname: profileId }, error: null }),
        then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
          if (table === "chat_messages") { reads++; requests.push(request); return read(request).then(resolve, reject); }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
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
          if (!(index in states)) states[index] = initial;
          return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
        },
        useRef: (current: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current }),
        useEffect: (effect: typeof effects[number], deps: unknown[]) => {
          const index = effectIndex++;
          effects[index] = effect;
          if (!effectDependencies[index] || deps.some((value, i) => !Object.is(value, effectDependencies[index][i]))) pendingEffects.push(index);
          effectDependencies[index] = deps;
        },
        useLayoutEffect: () => {},
      };
      if (name === "./room-connection") return { useRecordConnection: () => ({ state: phase, publish, retry }) };
      if (name === "./room-permissions") return { useRoomPermissions: () => permissions };
      if (name === "@/lib/supabase/client") return { supabase: client };
      return require(name.startsWith("./") ? `${name}.ts` : name);
    },
  });
  function render(roomId = "room") {
    stateIndex = effectIndex = refIndex = 0;
    pendingEffects = [];
    exports.default!({ roomId });
  }
  function flushEffects() {
    for (const index of pendingEffects) {
      disposers[index]?.();
      disposers[index] = effects[index]();
    }
    pendingEffects = [];
  }
  render();
  return {
    start: () => { flushEffects(); return () => { for (const dispose of disposers) dispose?.(); }; },
    updatePermissions(patch: Partial<typeof permissions>, roomId = "room") { permissions = { ...permissions, ...patch }; render(roomId); flushEffects(); },
    read: (next: typeof read) => { read = next; },
    status: (next: string) => status(next),
    insert: (next: ChatMessage) => insert({ new: next }),
    get messages() { return states[1] as ChatMessage[]; },
    get senderNames() { return states[2] as Record<string, string>; },
    get loadedRole() { return states[0]; },
    get phase() { return phase; },
    retry() { retry(); },
    get error() { return states[10] as string; },
    get reads() { return reads; },
    get removed() { return removed; },
    requests, profileIds,
    loadOlder: () => (refs[4].current as () => Promise<void>)(),
    get hasOlder() { return states[13]; },
    get loadingOlder() { return states[14]; },
    get olderError() { return states[15]; },
    dataset(messages: ChatMessage[]) {
      read = async ({ limit, before, since, sinceId }) => {
        const cursor = before?.match(/^created_at.lt.(.*),and\(created_at.eq.(.*),id.lt.(.*)\)$/);
        const data = messages.filter((m) => (!since || m.created_at > since || m.created_at === since && m.id >= sinceId!)
          && (!cursor || m.created_at < cursor[1] || m.created_at === cursor[1] && m.id < cursor[3]))
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, limit);
        return { data, error: null };
      };
    },
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
    h.status("SUBSCRIBED"); await settle();
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

test("최신 100건부터 1,000행을 넘는 동일 시각 기록을 커서로 누락·중복 없이 탐색한다", async () => {
  const h = harness();
  const messages = Array.from({ length: 1102 }, (_, i) => message(String(i).padStart(4, "0")));
  h.dataset(messages);
  const dispose = h.start(); await settle();
  assert.equal(h.messages.length, 100);
  assert.equal(h.messages[0].id, "1002");
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].limit, 100);
  assert.equal(h.hasOlder, true);
  h.status("SUBSCRIBED"); await settle();
  assert.equal(h.messages.length, 100);
  for (let i = 0; i < 11; i++) await h.loadOlder();
  assert.equal(h.messages.length, 1102);
  assert.equal(new Set(h.messages.map(({ id }) => id)).size, 1102);
  assert.deepEqual(h.messages.map(({ id }) => id), messages.map(({ id }) => id));
  assert.equal(h.hasOlder, false);
  dispose();
});

test("재연결은 최신 페이지보다 긴 누락 구간을 복구하고 수신 이벤트로 조회 범위를 좁히지 않는다", async () => {
  const h = harness();
  const messages = Array.from({ length: 150 }, (_, i) => message(String(i).padStart(4, "0"), i));
  h.dataset(messages);
  const dispose = h.start(); await settle();
  const missed = Array.from({ length: 1102 }, (_, i) => message(String(i + 150).padStart(4, "0"), i + 150));
  h.dataset([...messages, ...missed]);
  h.insert(missed.at(-1)!);
  h.status("SUBSCRIBED"); await settle();
  assert.equal(h.messages.length, 1202);
  assert.equal(h.messages[0].id, "0050");
  assert.equal(h.messages.at(-1)!.id, "1251");
  assert.equal(new Set(h.messages.map(({ id }) => id)).size, 1202);
  assert.equal(h.hasOlder, true);
  await h.loadOlder();
  assert.equal(h.messages.length, 1252);
  dispose();
});

test("이전 기록 실패·중복 클릭·동시 수신을 처리하고 같은 커서로 재시도한다", async () => {
  const h = harness();
  const messages = Array.from({ length: 201 }, (_, i) => message(String(i).padStart(4, "0"), i));
  h.dataset(messages);
  const dispose = h.start(); await settle();
  h.read(async () => ({ data: null, error: { message: "network" } }));
  await h.loadOlder(); assert.ok(h.olderError); assert.equal(h.messages.length, 100);
  const failed = h.requests.at(-1)!.before;
  const pending = deferred(); h.read(() => pending.promise);
  const loading = h.loadOlder(); await settle(); const reads = h.reads;
  await h.loadOlder(); assert.equal(h.reads, reads); assert.equal(h.loadingOlder, true);
  h.insert(message("live", 202));
  pending.resolve({ data: messages.slice(1, 101).reverse().map((m) => ({ ...m, sender_id: "past-sender" })), error: null });
  await loading;
  assert.equal(h.requests.at(-1)!.before, failed);
  assert.equal(h.olderError, ""); assert.equal(h.loadingOlder, false);
  assert.equal(h.messages.length, 201); assert.equal(h.senderNames["past-sender"], "past-sender");
  h.dataset(messages); await h.loadOlder();
  assert.equal(h.messages.length, 202); assert.equal(h.hasOlder, false);
  dispose();
});

test("이전 기록 조회 중 역할·룸·계정 변경과 권한 소실은 늦은 응답을 무시하고 커서를 초기화한다", async () => {
  for (const [patch, roomId] of [[{ role: "spectator" }, "room"], [{}, "another-room"], [{ currentUserId: "another-user" }, "room"], [{ role: null }, "room"]] as const) {
    const h = harness(); h.dataset(Array.from({ length: 201 }, (_, i) => message(String(i).padStart(4, "0"), i)));
    const dispose = h.start(); await settle();
    const pending = deferred(); h.read(() => pending.promise); const loading = h.loadOlder();
    h.read(async () => ({ data: [message("new-room")], error: null }));
    h.updatePermissions(patch, roomId); await settle();
    pending.resolve({ data: [message("stale-history")], error: null }); await loading;
    assert.ok(!h.messages.some(({ id }) => id === "stale-history"));
    assert.equal(h.hasOlder, false); assert.equal(h.loadingOlder, false);
    if (patch.role !== null) assert.equal(h.requests.at(-1)!.before, null);
    dispose();
  }
});

test("늦은 이전 동기화 응답은 새 조회를 덮어쓰지 않고 종료 후 응답·이벤트를 무시한다", async () => {
  const h = harness(); const old = deferred();
  h.read(() => old.promise);
  const dispose = h.start(); await settle();
  h.read(async () => ({ data: [message("latest")], error: null }));
  h.status("SUBSCRIBED"); await settle();
  old.resolve({ data: [message("stale")], error: null }); await settle();
  assert.deepEqual(h.messages.map(({ id }) => id), ["latest"]);
  const pending = deferred(); h.read(() => pending.promise); h.status("SUBSCRIBED"); await settle();
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

test("다른 참가자의 입장·역할 변경·퇴장은 채팅 기록과 구독을 초기화하지 않는다", async () => {
  const h = harness(); h.read(async () => ({ data: [message("history")], error: null }));
  const dispose = h.start(); await settle();
  const history = h.messages;
  const reads = h.reads;
  for (const members of [
    [{ user_id: "me" }, { user_id: "newcomer", role: "player" }],
    [{ user_id: "me" }, { user_id: "newcomer", role: "spectator" }],
    [{ user_id: "me" }],
  ]) {
    h.updatePermissions({ members });
    assert.equal(h.loadedRole, "player");
    assert.deepEqual(h.messages, history);
    await settle();
    assert.equal(h.reads, reads);
    assert.equal(h.removed, false);
  }
  h.insert({ ...message("new-member-message", 1), sender_id: "newcomer" }); await settle();
  assert.equal(h.senderNames.newcomer, "newcomer");
  assert.deepEqual(h.messages.map(({ id }) => id), ["history", "new-member-message"]);
  dispose();
});

test("본인 역할·계정·룸 변경은 이전 기록을 초기화하고 새 권한으로 다시 조회한다", async () => {
  for (const [patch, roomId, expectedRole] of [
    [{ role: "spectator" }, "room", "spectator"],
    [{ currentUserId: "another-user" }, "room", "player"],
    [{}, "another-room", "player"],
  ] as const) {
    const h = harness(); h.read(async () => ({ data: [message("old")], error: null }));
    const dispose = h.start(); await settle();
    const reads = h.reads;
    h.read(async () => ({ data: [message("new")], error: null }));
    h.updatePermissions(patch, roomId);
    assert.equal(h.loadedRole, null);
    assert.equal(h.messages.length, 0);
    assert.equal(h.removed, true);
    await settle();
    assert.ok(h.reads > reads);
    assert.equal(h.loadedRole, expectedRole);
    assert.deepEqual(h.messages.map(({ id }) => id), ["new"]);
    dispose();
  }
});

test("본인 접근 권한이 사라지면 기록을 지우고 이전 조회 응답과 수신을 무시한다", async () => {
  const h = harness(); const pending = deferred(); h.read(() => pending.promise);
  const dispose = h.start(); await settle(); const reads = h.reads;
  h.updatePermissions({ role: null });
  h.insert(message("late-event"));
  pending.resolve({ data: [message("late-response")], error: null }); await settle();
  assert.equal(h.messages.length, 0);
  assert.equal(h.loadedRole, null);
  assert.equal(h.removed, true);
  assert.equal(h.reads, reads);
  dispose();
});


test("빈 룸에서 시작한 뒤 한 페이지보다 많은 기록이 쌓여도 재연결로 모두 복구한다", async () => {
  const h = harness(); h.dataset([]);
  const dispose = h.start(); await settle();
  h.dataset(Array.from({ length: 201 }, (_, i) => message(String(i).padStart(4, "0"))));
  h.status("SUBSCRIBED"); await settle();
  assert.equal(h.messages.length, 201); assert.equal(h.hasOlder, false);
  dispose();
});
