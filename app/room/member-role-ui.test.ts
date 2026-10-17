import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { RoomRole } from "./room-permission.ts";
import { resolveRoomFeatureState } from "./room-permission.ts";

const require = createRequire(import.meta.url);
type Effect = { callback: () => void; deps: unknown[] };
type MapRuntime = {
  states?: unknown[];
  refs?: { current: unknown }[];
  effects?: Effect[];
  error?: string;
  canUse?: (feature: string) => boolean;
  client?: object;
  tree?: React.ReactElement;
};
function renderMap(role: RoomRole | null, loadedRole = role, checking = false, runtime: MapRuntime = {}) {
  const map = { id: "map-a", asset_id: "asset-a", grid_cell_size: 50, grid_offset_x: 0, grid_offset_y: 0, fog_enabled: false, mapUrl: "https://example.com/map.png" };
  const states = runtime.states ?? [[map], [{ id: "token-a", map_id: "map-a", owner_id: "other", name: "타인 토큰", x: 0, y: 0, size: 1 }], [], [], loadedRole,
    "map-a", { width: 100, height: 100 }, false, false, "", "", null, [], "all", "reveal", null, false, false, [], "freehand", "#E0B45B", 4, "", false, null, "", false];
  runtime.states = states;
  let index = 0;
  let refIndex = 0;
  const exports: { default?: React.FunctionComponent<{ roomId: string }> } = {};
  const compiled = ts.transpileModule(readFileSync(new URL("room-map.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === "react") return { ...React, useState: () => {
        const i = index++;
        return [states[i], (value: unknown) => { states[i] = typeof value === "function" ? value(states[i]) : value; }];
      }, useEffect: (callback: () => void, deps: unknown[]) => runtime.effects?.push({ callback, deps }),
      useRef: (value: unknown) => runtime.refs ? (runtime.refs[refIndex++] ??= { current: value }) : { current: value } };
      if (name === "./room-permissions") return { useRoomPermissions: () => ({ role, currentUserId: "me", members: [], checking, error: runtime.error ?? "", loading: false,
        canUse: runtime.canUse ?? ((feature: string) => !checking || feature === "map_view") }) };
      if (name === "@/lib/supabase/client") return { supabase: runtime.client ?? {} };
      if (name === "./room-tools") {
        const toolExports = {};
        const source = ts.transpileModule(readFileSync(new URL("room-tools.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
        runInNewContext(source, { exports: toolExports, require });
        return toolExports;
      }
      if (name === "./map-drawing-shape") return { __esModule: true, default: () => null };
      return require(name.startsWith("./") || name.startsWith("../") ? `${name}.ts` : name);
    },
  });
  runtime.tree = exports.default!({ roomId: "room-a" }) as React.ReactElement;
  return renderToStaticMarkup(runtime.tree);
}

test("공통 역할이 강등되면 맵 관리 UI와 타인 토큰 조작을 제거한다", () => {
  const master = renderMap("master");
  assert.match(master, /토큰 추가|Fog of War/); assert.match(master, /role="button"/);
  for (const role of ["player", "spectator"] as const) {
    const html = renderMap(role);
    assert.doesNotMatch(html, /토큰 추가|Fog of War|role="button"/);
  }
});

test("역할 변경 직후에는 이전 역할에서 읽은 맵·토큰을 표시하지 않는다", () => {
  const html = renderMap("player", "master");
  assert.doesNotMatch(html, /타인 토큰|https:\/\/example.com\/map.png|토큰 추가/);
});

test("권한 확인 중에는 맵 표시를 유지하면서 관리 폼과 토큰 조작을 비활성화한다", () => {
  const html = renderMap("master", "master", true);
  assert.match(html, /타인 토큰/); assert.doesNotMatch(html, /role="button"/);
  const input = html.match(/<input[^>]*name="name"[^>]*>/)?.[0];
  assert.ok(input); assert.match(input, /disabled=""/);
});

function dragHarness() {
  const drag = { tokenId: "token-a", pointerId: 1, offsetX: 0, offsetY: 0, startX: 2, startY: 2 };
  const points = [{ x: 10, y: 10 }, { x: 20, y: 20 }];
  const states: unknown[] = [[{ id: "map-a", asset_id: "asset-a", grid_cell_size: 50, grid_offset_x: 0, grid_offset_y: 0, fog_enabled: true, mapUrl: "https://example.com/map.png" }],
    [{ id: "token-a", map_id: "map-a", owner_id: "me", name: "토큰", x: 4, y: 4, size: 1 }], [], [], "master",
    "map-a", { width: 500, height: 500 }, false, false, "", "", drag, [], "all", "reveal",
    { pointerId: 1, start: points[0], current: points[1] }, true, false, [], "freehand", "#E0B45B", 4, "", true,
    { pointerId: 1, points }, "", false];
  const sent: unknown[] = [];
  const saved: unknown[] = [];
  const runtime: MapRuntime = { states, refs: [{ current: { send: (payload: unknown) => { sent.push(payload); } } }],
    client: { from: () => ({ update: (position: unknown) => {
      saved.push(position);
      return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "token-a" }, error: null }) }) }) };
    }, insert: (row: unknown) => {
      saved.push(row);
      return { select: () => ({ single: async () => ({ data: { id: "new-row" }, error: null }) }) };
    } }) } };
  let previous: Effect[] = [];
  function render(checking: boolean, role: RoomRole | null = "master", error = "", denied = false) {
    runtime.effects = []; runtime.error = error;
    const permissions = resolveRoomFeatureState(role, "me", [], checking);
    runtime.canUse = (feature) => !error && !denied && permissions[feature as keyof typeof permissions];
    const html = renderMap(role, "master", checking, runtime);
    const next = runtime.effects;
    if (previous.length) next.forEach((effect, i) => {
      // Data/subscription effects use Supabase; exercise the local gesture lifecycle here.
      if (!effect.callback.toString().includes("supabase") && effect.deps.some((dep, j) => !Object.is(dep, previous[i]?.deps[j]))) effect.callback();
    });
    previous = next;
    return html;
  }
  render(false);
  return { states, sent, saved, runtime, render, drag };
}

test("주기적 재조회와 복구는 진행 중인 토큰·그림·Fog 드래그를 보존한다", () => {
  for (const fogEditing of [true, false]) {
    const h = dragHarness();
    h.states[16] = fogEditing;
    const before = [h.states[11], h.states[15], h.states[24]];
    const html = h.render(true);
    assert.match(html, fogEditing ? /fog-interaction/ : /drawing-interaction/);
    h.render(false);
    assert.deepEqual([h.states[11], h.states[15], h.states[24]], before);
    assert.deepEqual(h.sent, []); assert.deepEqual(h.saved, []);
  }
});

test("실제 권한 상실·조회 실패는 드래그를 취소하고 토큰 원위치를 방송한다", () => {
  for (const scenario of [{ role: "spectator" as const, error: "", denied: false }, { role: null, error: "조회 실패", denied: false }]) {
    const h = dragHarness(); h.render(true); h.render(false, scenario.role, scenario.error, scenario.denied);
    assert.equal(h.states[11], null); assert.equal(h.states[15], null); assert.equal(h.states[24], null);
    assert.deepEqual((h.states[1] as { x: number; y: number }[]).map(({ x, y }) => ({ x, y })), [{ x: 2, y: 2 }]);
    assert.ok(h.sent.some((message) => JSON.stringify(message).includes('"x":2,"y":2')));
    assert.deepEqual(h.saved, []);
  }
});

function pointerUp(tree: React.ReactNode, className: string) {
  function find(node: React.ReactNode): React.ReactElement<{ onPointerUp: (event: unknown) => void }> | undefined {
    if (!React.isValidElement<{ className?: string; children?: React.ReactNode }>(node)) return;
    if (node.props.className === className) return node as React.ReactElement<{ onPointerUp: (event: unknown) => void }>;
    for (const child of React.Children.toArray(node.props.children)) { const found = find(child); if (found) return found; }
  }
  const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 500 }), hasPointerCapture: () => false };
  find(tree)!.props.onPointerUp({ pointerId: 1, clientX: 200, clientY: 200, currentTarget: { ...svg, ownerSVGElement: svg } });
}

test("조회 중 놓은 토큰은 권한 확인 성공 후 한 번 저장하고 강등되면 저장하지 않는다", () => {
  for (const role of ["master", "spectator"] as const) {
    const h = dragHarness(); h.render(true);
    pointerUp(h.runtime.tree, "room-map-canvas");
    assert.deepEqual(h.saved, []);
    h.render(false, role); h.render(false, role);
    assert.equal(h.saved.length, role === "master" ? 1 : 0);
    assert.equal(h.states[11], null);
  }
});

test("조회 중 종료한 그림·Fog는 재확인 뒤 저장하며 강등 시 폐기한다", () => {
  for (const type of ["drawing", "fog"]) for (const role of ["master", "spectator"] as const) {
    const h = dragHarness(); h.states[16] = type === "fog"; h.render(true);
    pointerUp(h.runtime.tree, `${type}-interaction`);
    assert.deepEqual(h.saved, []);
    h.render(false, role); h.render(false, role);
    assert.equal(h.saved.length, role === "master" ? 1 : 0);
    assert.equal(h.states[type === "drawing" ? 24 : 15], null);
  }
});

function element(tree: React.ReactNode, predicate: (node: React.ReactElement<Record<string, unknown>>) => boolean): React.ReactElement<Record<string, unknown>> | undefined {
  if (!React.isValidElement<Record<string, unknown>>(tree)) return;
  if (predicate(tree)) return tree;
  for (const child of React.Children.toArray(tree.props.children as React.ReactNode)) {
    const found = element(child, predicate);
    if (found) return found;
  }
}

function tools(runtime: MapRuntime) {
  return element(runtime.tree, (node) => typeof node.props.onDrawing === "function")!.props as {
    canDraw: boolean; canManageMap: boolean; onDrawing: () => void; onFog: () => void;
  };
}

test("도구 레일은 역할별 실제 그리기·시야 권한을 사용한다", () => {
  for (const role of ["master", "player", "spectator"] as const) {
    const runtime: MapRuntime = { canUse: (feature) => feature === "map_view" || role !== "spectator" };
    const html = renderMap(role, role, false, runtime);
    assert.equal(tools(runtime).canDraw, role !== "spectator");
    assert.equal(tools(runtime).canManageMap, role === "master");
    assert.doesNotMatch(html, /aria-label="(?:선택|이동|거리 측정|설정)"/);
    assert.match(html, /aria-controls="map-drawing-controls"/);
    assert.match(html, /aria-controls="map-fog-controls"/);
  }
});

test("맵 없음·이미지 로딩·조회 중·오류·권한 상실 시 레일에서 편집을 열지 않는다", () => {
  for (const scenario of ["empty", "image", "loading", "checking", "error", "permission-error", "denied"] as const) {
    const runtime: MapRuntime = {};
    renderMap("master", "master", false, runtime);
    if (scenario === "empty") runtime.states![0] = [];
    if (scenario === "image") runtime.states![6] = null;
    if (scenario === "loading") runtime.states![7] = true;
    if (scenario === "error") runtime.states![9] = "맵 조회 실패";
    if (scenario === "permission-error") runtime.error = "권한 조회 실패";
    if (scenario === "denied") runtime.canUse = () => false;
    renderMap("master", "master", scenario === "checking", runtime);
    assert.equal(tools(runtime).canDraw, false, scenario);
    assert.equal(tools(runtime).canManageMap, false, scenario);
    tools(runtime).onDrawing(); tools(runtime).onFog();
    assert.equal(runtime.states![23], false, scenario);
    assert.equal(runtime.states![16], false, scenario);
  }
});

test("레일과 기존 summary에서 편집을 전환하고 닫으면 토큰 조작 화면으로 복귀한다", () => {
  const runtime: MapRuntime = {};
  renderMap("master", "master", false, runtime);
  tools(runtime).onDrawing();
  let html = renderMap("master", "master", false, runtime);
  assert.match(html, /drawing-interaction/);
  assert.equal(runtime.states![16], false);
  tools(runtime).onFog();
  renderMap("master", "master", false, runtime);
  assert.equal(runtime.states![23], false);
  assert.equal(runtime.states![16], true);
  const summary = element(runtime.tree, (node) => node.type === "summary" && node.props.children === "Fog of War")!;
  (summary.props.onClick as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
  html = renderMap("master", "master", false, runtime);
  assert.equal(runtime.states![16], false);
  assert.doesNotMatch(html, /drawing-interaction|fog-interaction/);
  assert.match(html, /role="button" tabindex="0"/);
});

test("그리기 종료 후 토큰의 방향키 이동과 좌표 저장을 유지한다", () => {
  const h = dragHarness();
  h.states[11] = null; h.states[15] = null; h.states[24] = null;
  h.states[16] = false; h.states[23] = false;
  h.render(false);
  const token = element(h.runtime.tree, (node) => node.props.role === "button")!;
  let prevented = false;
  (token.props.onKeyDown as (event: { key: string; preventDefault: () => void }) => void)({ key: "ArrowRight", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.saved)), [{ x: 5, y: 4 }]);
});


test("빈 텍스트 입력 오류 뒤에도 그리기를 다시 열고 시야로 전환한다", () => {
  const runtime: MapRuntime = {};
  renderMap("master", "master", false, runtime);
  tools(runtime).onDrawing();
  runtime.states![19] = "text";
  renderMap("master", "master", false, runtime);
  const overlay = element(runtime.tree, node => node.props.className === "drawing-interaction")!;
  const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  (overlay.props.onPointerDown as (event: unknown) => void)({ clientX: 30, clientY: 30, currentTarget: { ownerSVGElement: svg } });
  assert.match(renderMap("master", "master", false, runtime), /텍스트를 입력한 뒤 맵을 선택하세요/);
  const summary = element(runtime.tree, node => node.type === "summary" && node.props.children === "그리기")!;
  (summary.props.onClick as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
  renderMap("master", "master", false, runtime);
  assert.equal(runtime.states![23], false);
  assert.equal(tools(runtime).canDraw, true);
  assert.equal(tools(runtime).canManageMap, true);
  tools(runtime).onDrawing();
  assert.match(renderMap("master", "master", false, runtime), /drawing-interaction/);
  tools(runtime).onFog();
  renderMap("master", "master", false, runtime);
  assert.equal(runtime.states![23], false);
  assert.equal(runtime.states![16], true);
});

test("그림 저장 실패 뒤 재열기·재시도가 가능하고 성공하면 오류를 지운다", async () => {
  let fail = true;
  const runtime: MapRuntime = { client: { from: () => ({ insert: (row: object) => ({ select: () => ({ single: async () => fail
    ? { data: null, error: { message: "일시적 저장 실패" } }
    : { data: { ...row, id: "drawing-retry" }, error: null } }) }) }) } };
  renderMap("master", "master", false, runtime);
  tools(runtime).onDrawing();
  runtime.states![19] = "text";
  runtime.states![22] = "재시도";
  function draw() {
    renderMap("master", "master", false, runtime);
    const overlay = element(runtime.tree, node => node.props.className === "drawing-interaction")!;
    const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
    (overlay.props.onPointerDown as (event: unknown) => void)({ clientX: 30, clientY: 30, currentTarget: { ownerSVGElement: svg } });
  }
  draw();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.match(renderMap("master", "master", false, runtime), /그림을 저장할 수 없습니다/);
  tools(runtime).onDrawing();
  renderMap("master", "master", false, runtime);
  assert.equal(tools(runtime).canDraw, true);
  tools(runtime).onDrawing();
  fail = false;
  draw();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.doesNotMatch(renderMap("master", "master", false, runtime), /그림을 저장할 수 없습니다/);
  assert.equal((runtime.states![18] as unknown[]).length, 1);
});
