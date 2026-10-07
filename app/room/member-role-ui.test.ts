import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { RoomRole } from "./room-permission.ts";

const require = createRequire(import.meta.url);
function renderMap(role: RoomRole, loadedRole = role, checking = false) {
  const map = { id: "map-a", asset_id: "asset-a", grid_cell_size: 50, grid_offset_x: 0, grid_offset_y: 0, fog_enabled: false, mapUrl: "https://example.com/map.png" };
  const states = [[map], [{ id: "token-a", map_id: "map-a", owner_id: "other", name: "타인 토큰", x: 0, y: 0, size: 1 }], [], [], loadedRole,
    "map-a", { width: 100, height: 100 }, false, false, "", "", null, [], "all", "reveal", null, false, false, [], "freehand", "#E0B45B", 4, "", false, null, "", false];
  let index = 0;
  const exports: { default?: React.ComponentType<{ roomId: string }> } = {};
  const compiled = ts.transpileModule(readFileSync(new URL("room-map.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === "react") return { ...React, useState: () => [states[index++], () => {}], useEffect: () => {}, useRef: () => ({ current: null }) };
      if (name === "./room-permissions") return { useRoomPermissions: () => ({ role, currentUserId: "me", members: [], checking, error: "", loading: false,
        canUse: (feature: string) => !checking || feature === "map_view" }) };
      if (name === "@/lib/supabase/client") return { supabase: {} };
      if (name === "./map-drawing-shape") return { default: () => null };
      return require(name.startsWith("./") || name.startsWith("../") ? `${name}.ts` : name);
    },
  });
  return renderToStaticMarkup(React.createElement(exports.default!, { roomId: "room-a" }));
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
