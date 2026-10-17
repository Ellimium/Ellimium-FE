import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("room-map.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const map = (id: string) => ({ id, asset_id: id, fog_enabled: false });
type Row = ReturnType<typeof map>;
type Result = { data: Row[] | null; error: { message: string } | null };

// Run the actual component's list effect with controllable API and channel responses.
function harness(canView = true) {
  const states: unknown[] = [];
  const mapUpdates: Row[][] = [];
  const areaUpdates: Record<string, unknown>[][] = [];
  let stateIndex = 0;
  let effect!: () => void | (() => void);
  let effectIndex = 0;
  const effects: (() => void | (() => void))[] = [];
  const refs: { current: unknown }[] = [];
  let refIndex = 0;
  let fog!: (payload: { new: { fog_enabled: boolean } }) => void;
  let visibility!: (payload: { new: Record<string, unknown> }) => void;
  let visibilityRows: Record<string, unknown>[] = [];
  let holdUrls = false;
  let releaseUrls!: () => void;
  let status!: (status: string) => void;
  let insert!: () => void;
  let reads = 0;
  let removed = false;
  let read: () => Promise<Result> = async () => ({ data: [map("first")], error: null });
  const window = new EventTarget();
  const channel = {
    on: (event: string, filter: unknown, callback: () => void) => {
      assert.equal(event, "postgres_changes");
      assert.deepEqual(JSON.parse(JSON.stringify(filter)), {
        event: "INSERT", schema: "public", table: "room_maps", filter: "room_id=eq.room",
      });
      insert = callback; return channel;
    },
    subscribe: (callback: typeof status) => { status = callback; return channel; },
  };
  const supabase = {
    channel: (name: string, options?: { config: { postgres_changes_options: { wait: boolean } } }) => {
      if (name.startsWith("map-visibility:")) {
        const channel = {
          on: (_event: string, filter: { table: string }, callback: (payload: { new: Record<string, unknown> }) => void) => {
            if (filter.table === "room_maps") fog = callback;
            else visibility = callback;
            return channel;
          },
          subscribe: () => channel,
        };
        return channel;
      }
      assert.equal(name, "room:room:maps");
      assert.equal(options?.config.postgres_changes_options.wait, true);
      return channel;
    },
    removeChannel: async () => { removed = true; },
    from: (table: string) => {
      let ids: string[] = [];
      const query = {
        select: () => query, order: () => query,
        eq: (field: string, value: string) => {
          if (table === "room_maps") { assert.equal(field, "room_id"); assert.equal(value, "room"); }
          return query;
        },
        in: (_field: string, values: string[]) => { ids = values; return query; },
        then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
          if (table === "room_maps") { reads++; return read().then(resolve, reject); }
          const data = table === "assets" ? ids.map((id) => ({ id, category: "map", storage_path: id })) : table === "map_visibility" ? visibilityRows : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => {
      if (holdUrls) {
        holdUrls = false;
        await new Promise<void>((resolve) => { releaseUrls = resolve; });
      }
      return { data: paths.map((path) => ({ path, signedUrl: `https://example.test/${path}` })), error: null };
    } }) },
  };
  const exports: { default?: React.FunctionComponent<{ roomId: string }> } = {};
  runInNewContext(compiled, {
    exports, window,
    require: (name: string) => {
      if (name === "react") return { ...React,
        useState: (initial: unknown) => {
          const index = stateIndex++; if (!(index in states)) states[index] = initial;
          return [states[index], (next: unknown) => {
            states[index] = typeof next === "function" ? next(states[index]) : next;
            if (index === 0) mapUpdates.push(states[index] as Row[]);
            if (index === 12) areaUpdates.push(states[index] as Record<string, unknown>[]);
          }];
        },
        useRef: (current: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current }),
        useEffect: (callback: typeof effect) => { effects[effectIndex] = callback; if (effectIndex++ === 0) effect = callback; },
      };
      if (name === "./room-permissions") return { useRoomPermissions: () => ({
        role: "player", currentUserId: "me", members: [], checking: false, error: "", loading: false, canUse: () => canView,
      }) };
      if (name === "@/lib/supabase/client") return { supabase };
      if (name === "./room-tools") return { default: () => null };
      if (name === "./map-drawing-shape") return { default: () => null };
      return require(name.startsWith("./") || name.startsWith("../") ? `${name}.ts` : name);
    },
  });
  exports.default!({ roomId: "room" });
  return {
    start: () => effect(), status: (value: string) => status(value), insert: () => insert(),
    local: () => window.dispatchEvent(Object.assign(new Event("room-map-registered"), { detail: "room" })),
    read: (callback: typeof read) => { read = callback; },
    subscribeVisibility: () => {
      stateIndex = effectIndex = refIndex = 0;
      exports.default!({ roomId: "room" });
      return effects[6]();
    },
    fog: (enabled: boolean) => fog({ new: { fog_enabled: enabled } }),
    visibility: (row: Record<string, unknown>) => visibility({ new: row }),
    visibilityRows: (rows: Record<string, unknown>[]) => { visibilityRows = rows; },
    holdUrls: () => { holdUrls = true; }, releaseUrls: () => releaseUrls(),
    get areas() { return states[12] as Record<string, unknown>[]; },
    mapUpdates, areaUpdates,
    get maps() { return states[0] as Row[]; }, get selected() { return states[5]; },
    get error() { return states[9]; }, get loading() { return states[7]; },
    get reads() { return reads; }, get removed() { return removed; },
  };
}

test("빈 목록에서도 다른 참가자의 INSERT와 재연결을 반영하고 선택·중복 없는 목록을 유지한다", async () => {
  const h = harness(); h.read(async () => ({ data: [], error: null }));
  const dispose = h.start(); await settle(); assert.equal(h.maps.length, 0);
  h.read(async () => ({ data: [map("first")], error: null }));
  h.insert(); await settle(); assert.equal(h.selected, "first");
  h.read(async () => ({ data: [map("second"), map("first")], error: null }));
  h.local(); h.insert(); h.status("SUBSCRIBED"); await settle();
  assert.deepEqual(Array.from(h.maps, (row) => row.id), ["second", "first"]);
  assert.equal(h.selected, "first");
  h.read(async () => ({ data: [map("third")], error: null }));
  h.status("SUBSCRIBED"); await settle(); assert.equal(h.selected, "third");
  dispose?.(); assert.equal(h.removed, true);
});

test("오래된 조회 결과와 구독 해제 후 이벤트·응답을 무시한다", async () => {
  const h = harness(); let resolve!: (result: Result) => void;
  h.read(() => new Promise((done) => { resolve = done; }));
  const dispose = h.start(); await settle();
  h.read(async () => ({ data: [map("new")], error: null }));
  h.insert(); await settle(); resolve({ data: [map("old")], error: null }); await settle();
  assert.equal(h.maps[0].id, "new");
  h.read(() => new Promise((done) => { resolve = done; })); h.insert(); await settle();
  dispose?.(); const reads = h.reads;
  h.insert(); h.status("SUBSCRIBED"); h.local();
  resolve({ data: [map("late")], error: null }); await settle();
  assert.equal(h.reads, reads); assert.equal(h.maps[0].id, "new");
});

test("권한 없으면 구독·조회하지 않고 조회 실패 후 재접속하면 복구한다", async () => {
  const denied = harness(false); denied.start(); await settle();
  assert.equal(denied.reads, 0); assert.equal(denied.maps.length, 0);
  const h = harness(); const dispose = h.start(); await settle();
  h.read(async () => { throw new Error("offline"); }); h.insert(); await settle();
  assert.equal(h.maps[0].id, "first"); assert.equal(h.loading, false); assert.ok(h.error);
  h.read(async () => ({ data: [map("first"), map("second")], error: null }));
  h.status("SUBSCRIBED"); await settle(); assert.equal(h.maps.length, 2); assert.equal(h.error, "");
  dispose?.();
});

for (const enabled of [true, false]) {
  test(`목록 조회 중 도착한 Fog ${enabled ? "ON" : "OFF"} 이벤트를 유지하며 새 맵도 반영한다`, async () => {
    const h = harness(); h.read(async () => ({ data: [{ ...map("first"), fog_enabled: !enabled }], error: null }));
    const dispose = h.start(); await settle(); const disposeVisibility = h.subscribeVisibility();
    h.holdUrls(); h.insert(); await settle();
    h.fog(enabled); assert.equal(h.maps[0].fog_enabled, enabled);
    const updateCount = h.mapUpdates.length;
    h.read(async () => ({ data: [{ ...map("first"), fog_enabled: enabled }, map("second")], error: null }));
    h.releaseUrls(); await settle();
    assert.equal(h.maps[0].fog_enabled, enabled);
    assert.ok(h.mapUpdates.slice(updateCount).every((rows) => rows[0].fog_enabled === enabled));
    assert.equal(h.maps.length, 2); assert.equal(h.selected, "first"); assert.equal(h.loading, false);
    disposeVisibility?.(); dispose?.();
  });
}

test("목록 조회 중 도착한 시야 영역 갱신을 오래된 조회로 되돌리지 않는다", async () => {
  const h = harness();
  const oldRow = { id: "visibility", map_id: "first", scope: "all", inherits_common: false, revealed_areas: [{ x: 0, y: 0, width: 10, height: 10 }] };
  const newRow = { ...oldRow, revealed_areas: [] };
  h.visibilityRows([oldRow]); const dispose = h.start(); await settle(); const disposeVisibility = h.subscribeVisibility();
  h.holdUrls(); h.insert(); await settle();
  h.visibility(newRow); h.visibilityRows([newRow]);
  const updateCount = h.areaUpdates.length;
  h.read(async () => ({ data: [map("first"), map("second")], error: null }));
  h.releaseUrls(); await settle();
  assert.equal((h.areas[0].revealed_areas as unknown[]).length, 0);
  assert.ok(h.areaUpdates.slice(updateCount).every((rows) => (rows[0].revealed_areas as unknown[]).length === 0));
  assert.equal(h.maps.length, 2);
  disposeVisibility?.(); dispose?.();
});
