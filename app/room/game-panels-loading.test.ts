import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

test("권한 조회가 늦어도 시트는 확정된 GM·플레이어 패널에서 처음 마운트된다", () => {
  const require = createRequire(import.meta.url);
  let permissions = { loading: true, role: "master", currentUserId: "gm" };
  const module = { exports: {} as { default: ComponentType<{ panels: { id: string; title: string; content: ReactNode }[] }> } };
  const source = readFileSync(new URL("game-panels.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020,
  } }).outputText;
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: (id: string) => {
      if (id === "./room-permissions") return { useRoomPermissions: () => permissions };
      if (id === "@/lib/supabase/client") return { supabase: {} };
      if (id === "./gm-screen-settings") return require("./gm-screen-settings.ts");
      return require(id);
    },
  });
  let mounts = 0;
  function Sheet() { mounts++; return createElement("textarea", { defaultValue: "미저장 입력" }); }
  const panels = [{ id: "character-sheets", title: "캐릭터 시트", content: createElement(Sheet) }];
  const render = () => renderToStaticMarkup(createElement(module.exports.default, { panels }));

  assert.match(render(), /권한을 확인하는 중/);
  assert.match(render(), /aria-busy="true"/);
  assert.equal(mounts, 0);
  permissions = { ...permissions, loading: false };
  assert.match(render(), /gm-game-panel/);
  assert.equal(mounts, 1);
  permissions = { loading: true, role: "player", currentUserId: "player" };
  render();
  assert.equal(mounts, 1);
  permissions = { ...permissions, loading: false };
  assert.match(render(), /미저장 입력/);
  assert.equal(mounts, 2);
});


test("일시적 권한 오류는 GM 패널을 재마운트하지 않고 실제 역할·계정·룸 변경은 이전 배치를 버린다", () => {
  const require = createRequire(import.meta.url);
  let permissions = { loading: false, role: "master" as string | null, currentUserId: "gm", error: "" };
  let ref: { current: unknown } | undefined;
  const module = { exports: {} as { default: (props: { panels: []; roomId: string }) => { type: unknown; key: string | null } } };
  const source = readFileSync(new URL("game-panels.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: (id: string) => {
      if (id === "react") return { ...require("react"), useRef: (value: unknown) => ref ?? (ref = { current: value }), useEffect: (effect: () => void) => effect() };
      if (id === "./room-permissions") return { useRoomPermissions: () => permissions };
      if (id === "@/lib/supabase/client") return { supabase: {} };
      if (id === "./gm-screen-settings") return require("./gm-screen-settings.ts");
      return require(id);
    },
  });
  const render = (roomId = "room") => module.exports.default({ panels: [], roomId });
  const before = render();
  permissions = { ...permissions, role: null, error: "offline" };
  const offline = render(); assert.equal(offline.type, before.type); assert.equal(offline.key, before.key);
  permissions = { ...permissions, currentUserId: "another-user" }; assert.equal(render().type, "aside");
  permissions = { ...permissions, currentUserId: "gm" }; assert.equal(render("another-room").type, "aside");
  permissions = { ...permissions, role: "player", error: "" }; assert.equal(render().type, "aside");
  permissions = { ...permissions, role: null, error: "offline" }; assert.equal(render().type, "aside");
});
