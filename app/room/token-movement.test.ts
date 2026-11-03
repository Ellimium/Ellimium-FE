import assert from "node:assert/strict";
import test from "node:test";
import { createTokenMovement, movementTime, type TokenPosition } from "./token-movement.ts";

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function harness(onSend?: (position: TokenPosition) => void) {
  let db = { x: 1, y: 2 };
  let shown = { ...db };
  let failSend = false;
  let failSave = false;
  let sendGate: Promise<void> | undefined;
  let saveGate: Promise<void> | undefined;
  let readGate: Promise<void> | undefined;
  const calls: string[] = [];
  const errors: string[] = [];
  const applied: TokenPosition[] = [];
  const sync = createTokenMovement({
    userId: "me",
    send: async (_id, position) => {
      calls.push(`send:${position.x}`);
      await sendGate;
      if (failSend) throw new Error("permission revoked");
      onSend?.(position);
    },
    save: async (_id, position) => {
      calls.push(`save:${position.x}`);
      await saveGate;
      if (failSave) throw new Error("update denied");
      db = { ...position };
    },
    read: async () => { const snapshot = { ...db }; await readGate; return snapshot; },
    apply: (_id, position) => { shown = { x: position.x, y: position.y }; applied.push({ ...shown }); },
    error: (message) => errors.push(message),
  });
  const event = (x: number, fraction: string, sender = "peer") => sync.receive({ token_id: "token", sender_id: sender, x, y: x, sent_at: `2026-11-03T00:00:00.${fraction}Z` });
  return {
    sync, event, calls, errors, applied,
    get shown() { return shown; }, get db() { return db; },
    dbPosition: (position: TokenPosition) => { db = position; },
    failSend: () => { failSend = true; }, failSave: () => { failSave = true; },
    holdSend: (promise: Promise<void>) => { sendGate = promise; },
    holdSave: (promise: Promise<void>) => { saveGate = promise; },
    holdRead: (promise: Promise<void>) => { readGate = promise; },
  };
}

test("서버 시각의 마이크로초와 시간대를 보존한다", () => {
  assert.equal(movementTime("2026-11-03T09:00:00.123456+09:00"), movementTime("2026-11-03T00:00:00.123456Z"));
  assert.equal(movementTime("2026-11-03T00:00:00.123457Z") - movementTime("2026-11-03T00:00:00.123456Z"), 1);
  assert.ok(Number.isNaN(movementTime(undefined)));
});

test("진행 중 RPC 뒤에는 최신 미리보기만 보내고 최종 저장을 직렬화한다", async () => {
  const h = harness(); const gate = deferred(); h.holdSend(gate.promise);
  h.sync.preview("token", { x: 3, y: 3 }); await settle();
  h.sync.preview("token", { x: 4, y: 4 });
  h.sync.preview("token", { x: 5, y: 5 });
  const done = h.sync.finish("token", { x: 6, y: 6 }); await settle();
  assert.deepEqual(h.calls, ["send:3"]);
  h.event(3, "001000", "me"); assert.equal(h.shown.x, 6);
  gate.resolve(); await done;
  assert.deepEqual(h.calls, ["send:3", "save:6"]);
  assert.deepEqual(h.db, { x: 6, y: 6 }); h.sync.dispose();
});

test("임시 송신 실패가 성공한 DB 확정 저장을 되돌리지 않는다", async () => {
  const h = harness(); h.failSend();
  h.sync.preview("token", { x: 3, y: 3 }); await settle();
  await h.sync.finish("token", { x: 8, y: 8 });
  assert.equal(h.shown.x, 8); assert.equal(h.db.x, 8);
  assert.ok(h.errors.some((message) => message.includes("임시 이동"))); h.sync.dispose();
});

test("저장 실패는 드래그 시작점 대신 최신 DB 확정 위치로 복구한다", async () => {
  const h = harness(); h.failSave(); h.dbPosition({ x: 20, y: 21 });
  await h.sync.finish("token", { x: 8, y: 8 });
  assert.deepEqual(h.shown, { x: 20, y: 21 });
  assert.ok(h.errors.some((message) => message.includes("최종 위치"))); h.sync.dispose();
});

test("취소는 대기 미리보기를 폐기하고 진행 중 요청 뒤에 DB 복구를 보낸다", async () => {
  const h = harness(); const gate = deferred(); h.holdSend(gate.promise);
  h.sync.preview("token", { x: 3, y: 3 }); await settle();
  h.sync.preview("token", { x: 9, y: 9 });
  const done = h.sync.cancel("token"); gate.resolve(); await done;
  assert.deepEqual(h.calls, ["send:3", "send:1"]);
  assert.equal(h.shown.x, 1); h.sync.dispose();
});

test("권한 상실로 복구 송신도 거부되면 수신자는 idle 후 DB로 복구한다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = harness(); const receiver = harness();
  sender.failSend(); receiver.event(9, "001000"); assert.equal(receiver.shown.x, 9);
  await sender.sync.cancel("token"); assert.equal(sender.shown.x, 1);
  t.mock.timers.tick(1000); await settle(); assert.equal(receiver.shown.x, 1);
  assert.ok(sender.errors.some((message) => message.includes("복구 위치")));
  sender.sync.dispose(); receiver.sync.dispose();
});

test("지연·순서 역전 메시지는 최신 미리보기와 DB 확정 좌표를 덮어쓰지 않는다", () => {
  const h = harness();
  h.event(8, "123456"); h.event(3, "123455"); assert.equal(h.shown.x, 8);
  h.sync.confirmed("token", { x: 10, y: 10 }, "2026-11-03T00:00:00.123457Z");
  h.event(8, "123456"); assert.equal(h.shown.x, 10);
  h.sync.confirmed("token", { x: 2, y: 2 }, "2026-11-03T00:00:00.123454Z");
  assert.equal(h.shown.x, 10);
  h.event(12, "123459");
  h.sync.confirmed("token", { x: 11, y: 11 }, "2026-11-03T00:00:00.123458Z");
  assert.equal(h.shown.x, 12); h.sync.dispose();
});

test("복구 조회 중 새 메시지나 로컬 조작이 오면 오래된 조회 결과를 무시한다", async () => {
  const h = harness(); const gate = deferred(); h.holdRead(gate.promise);
  const read = h.sync.recover("token");
  h.event(9, "001000"); gate.resolve(); await read;
  assert.equal(h.shown.x, 9);
  const second = h.sync.recover("token"); h.sync.preview("token", { x: 7, y: 7 }); await second;
  assert.equal(h.shown.x, 7); h.sync.dispose();
});

test("연속 키 이동은 최신 확정 저장만 수행하고 종료 후 callback을 폐기한다", async () => {
  const h = harness(); const first = h.sync.finish("token", { x: 2, y: 2 });
  const last = h.sync.finish("token", { x: 3, y: 3 }); await Promise.all([first, last]);
  assert.deepEqual(h.calls, ["save:3"]);
  const gate = deferred(); h.holdSend(gate.promise);
  h.sync.preview("token", { x: 4, y: 4 }); await settle();
  const done = h.sync.finish("token", { x: 5, y: 5 }); h.sync.dispose(); gate.resolve(); await done;
  assert.equal(h.db.x, 3); assert.equal(h.shown.x, 5);
});

test("현재 드래그의 서버 권한 거부는 드래그를 종료하고 확정 좌표로 복구한다", async () => {
  let shown = { x: 0, y: 0 }; let denied = 0;
  const sync = createTokenMovement({
    userId: "me", send: async () => { throw { code: "42501" }; }, save: async () => {},
    read: async () => ({ x: 2, y: 3 }), apply: (_id, p) => { shown = p; }, error: () => {}, denied: () => { denied++; },
  });
  sync.preview("token", { x: 9, y: 9 }); await settle();
  assert.equal(denied, 1); assert.deepEqual(shown, { x: 2, y: 3 }); sync.dispose();
});

test("기존 연결의 늦은 권한 오류는 새 제스처나 종료된 화면을 취소하지 않는다", async () => {
  const gate = deferred(); let denied = 0;
  const sync = createTokenMovement({
    userId: "me", send: async () => { await gate.promise; throw { code: "42501" }; }, save: async () => {},
    read: async () => ({ x: 0, y: 0 }), apply: () => {}, error: () => {}, denied: () => { denied++; },
  });
  sync.preview("token", { x: 1, y: 1 }); await settle();
  sync.dispose(); gate.resolve(); await settle(); assert.equal(denied, 0);
});

test("새 드래그를 취소해도 RPC 뒤에 대기 중인 직전 완료 이동은 저장한다", async () => {
  const h = harness(); const gate = deferred(); h.holdSend(gate.promise);
  h.sync.preview("token", { x: 2, y: 2 }); await settle();
  const completed = h.sync.finish("token", { x: 3, y: 3 });
  h.sync.preview("token", { x: 4, y: 4 });
  const cancelled = h.sync.cancel("token");
  gate.resolve(); await Promise.all([completed, cancelled]);
  assert.deepEqual(h.calls, ["send:2", "save:3", "send:3"]);
  assert.deepEqual(h.db, { x: 3, y: 3 });
  assert.deepEqual(h.shown, { x: 3, y: 3 }); h.sync.dispose();
});

test("새 드래그 중 직전 완료 이동을 저장해도 새 미리보기는 유지한다", async () => {
  const h = harness(); const gate = deferred(); h.holdSend(gate.promise);
  h.sync.preview("token", { x: 2, y: 2 }); await settle();
  const completed = h.sync.finish("token", { x: 3, y: 3 });
  h.sync.preview("token", { x: 4, y: 4 });
  gate.resolve(); await completed;
  assert.deepEqual(h.db, { x: 3, y: 3 });
  assert.deepEqual(h.shown, { x: 4, y: 4 });
  await h.sync.finish("token", { x: 5, y: 5 });
  assert.deepEqual(h.calls.filter((call) => call.startsWith("save:")), ["save:3", "save:5"]);
  assert.deepEqual(h.db, { x: 5, y: 5 }); h.sync.dispose();
});


test("이미 실행 중인 확정 저장 뒤에 다음 확정 저장을 순서대로 실행한다", async () => {
  const h = harness(); const gate = deferred(); h.holdSave(gate.promise);
  const first = h.sync.finish("token", { x: 2, y: 2 }); await settle();
  const second = h.sync.finish("token", { x: 3, y: 3 }); await settle();
  assert.deepEqual(h.calls, ["save:2"]);
  assert.deepEqual(h.shown, { x: 3, y: 3 });
  gate.resolve(); await Promise.all([first, second]);
  assert.deepEqual(h.calls, ["save:2", "save:3"]);
  assert.deepEqual(h.db, { x: 3, y: 3 });
  assert.deepEqual(h.shown, { x: 3, y: 3 }); h.sync.dispose();
});

test("직전 완료 이동의 저장 실패는 알리되 새 드래그의 미리보기를 되돌리지 않는다", async () => {
  const h = harness(); const gate = deferred(); h.holdSend(gate.promise); h.failSave();
  h.sync.preview("token", { x: 2, y: 2 }); await settle();
  const completed = h.sync.finish("token", { x: 3, y: 3 });
  h.sync.preview("token", { x: 4, y: 4 });
  gate.resolve(); await completed;
  assert.ok(h.calls.includes("save:3"));
  assert.ok(h.errors.some((message) => message.includes("최종 위치")));
  assert.deepEqual(h.shown, { x: 4, y: 4 });
  assert.deepEqual(h.db, { x: 1, y: 2 }); h.sync.dispose();
});


for (const failRestore of [false, true]) {
  test(`지연된 취소 조회 중 마스터가 확정하면 이전 좌표를 적용·송신하지 않는다 (복구 거부=${failRestore})`, async () => {
    const receiver = harness();
    const sender = harness((position) => receiver.sync.receive({ token_id: "token", sender_id: "me", ...position, sent_at: "2026-11-03T00:00:00.300000Z" }));
    const gate = deferred(); sender.holdRead(gate.promise);
    if (failRestore) sender.failSend();
    const cancelled = sender.sync.cancel("token"); await settle();
    for (const h of [sender, receiver]) {
      h.dbPosition({ x: 20, y: 20 });
      h.sync.confirmed("token", { x: 20, y: 20 }, "2026-11-03T00:00:00.200000Z");
    }
    gate.resolve(); await cancelled;
    assert.deepEqual(sender.calls, ["send:20"]);
    for (const h of [sender, receiver]) {
      assert.deepEqual(h.shown, { x: 20, y: 20 });
      assert.ok(h.applied.every((position) => position.x === 20));
      h.sync.dispose();
    }
    assert.equal(sender.errors.length, failRestore ? 1 : 0);
  });
}

test("취소 재조회 도중 확정 갱신이 다시 오면 그 조회도 폐기하고 최신 위치를 읽는다", async () => {
  const h = harness(); const first = deferred(); const second = deferred(); h.holdRead(first.promise);
  const cancelled = h.sync.cancel("token"); await settle();
  h.dbPosition({ x: 20, y: 20 }); h.sync.confirmed("token", { x: 20, y: 20 }, "2026-11-03T00:00:00.200000Z");
  h.holdRead(second.promise); first.resolve(); await settle();
  h.dbPosition({ x: 30, y: 30 }); h.sync.confirmed("token", { x: 30, y: 30 }, "2026-11-03T00:00:00.300000Z");
  h.holdRead(Promise.resolve()); second.resolve(); await cancelled;
  assert.deepEqual(h.calls, ["send:30"]); assert.deepEqual(h.shown, { x: 30, y: 30 });
  assert.deepEqual(h.applied.map((p) => p.x), [20, 30, 30, 30]); h.sync.dispose();
});

test("취소 조회 중 새 로컬 드래그를 시작하면 취소 결과를 적용·방송하지 않는다", async () => {
  const h = harness(); const gate = deferred(); h.holdRead(gate.promise);
  const cancelled = h.sync.cancel("token"); await settle();
  h.sync.preview("token", { x: 9, y: 9 }); gate.resolve(); await cancelled; await settle();
  assert.deepEqual(h.calls, ["send:9"]); assert.deepEqual(h.shown, { x: 9, y: 9 }); h.sync.dispose();
});

test("취소 조회 중 새 확정 이동을 요청하면 이전 취소 방송 없이 새 위치를 저장한다", async () => {
  const h = harness(); const gate = deferred(); h.holdRead(gate.promise);
  const cancelled = h.sync.cancel("token"); await settle();
  const completed = h.sync.finish("token", { x: 9, y: 9 }); gate.resolve(); await Promise.all([cancelled, completed]);
  assert.deepEqual(h.calls, ["save:9"]); assert.deepEqual(h.db, { x: 9, y: 9 }); h.sync.dispose();
});

test("취소 조회 중 새 상대 미리보기가 오면 이를 이전 DB 좌표로 덮어쓰지 않는다", async () => {
  const h = harness(); const gate = deferred(); h.holdRead(gate.promise);
  const cancelled = h.sync.cancel("token"); await settle();
  h.event(9, "300000"); gate.resolve(); await cancelled;
  assert.deepEqual(h.calls, []); assert.deepEqual(h.shown, { x: 9, y: 9 }); h.sync.dispose();
});

test("취소 조회 중 연결이 정리되면 적용·복구 송신·재조회를 중단한다", async () => {
  const h = harness(); const gate = deferred(); h.holdRead(gate.promise);
  const cancelled = h.sync.cancel("token"); await settle(); h.sync.dispose(); gate.resolve(); await cancelled;
  assert.deepEqual(h.calls, []); assert.deepEqual(h.applied, []);
});

test("취소 조회의 지연된 실패가 최신 확정 갱신을 덮지 않고 새 조회로 복구한다", async () => {
  const h = harness(); const gate = Promise.withResolvers<void>(); h.holdRead(gate.promise);
  const cancelled = h.sync.cancel("token"); await settle();
  h.dbPosition({ x: 20, y: 20 }); h.sync.confirmed("token", { x: 20, y: 20 }, "2026-11-03T00:00:00.200000Z");
  h.holdRead(Promise.resolve()); gate.reject(new Error("obsolete read failure")); await cancelled;
  assert.deepEqual(h.calls, ["send:20"]); assert.deepEqual(h.errors, []);
  assert.ok(h.applied.every((position) => position.x === 20)); h.sync.dispose();
});

test("취소 조회의 지연된 실패 후에도 새 상대 미리보기를 이전 DB 좌표로 되돌리지 않는다", async () => {
  const h = harness(); const gate = Promise.withResolvers<void>(); h.holdRead(gate.promise);
  const cancelled = h.sync.cancel("token"); await settle(); h.event(9, "300000");
  h.holdRead(Promise.resolve()); gate.reject(new Error("obsolete read failure")); await cancelled;
  assert.deepEqual(h.calls, []); assert.deepEqual(h.errors, []);
  assert.deepEqual(h.shown, { x: 9, y: 9 }); h.sync.dispose();
});
