import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { Children, createElement, isValidElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

type Panel = { id: string; title: string; content: ReactNode };

function load(file: string, require: (id: string) => unknown) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(compiled, { module, exports: module.exports, require });
  return module.exports;
}

async function roomPanels(role: string) {
  const require = createRequire(import.meta.url);
  const { default: GamePanels } = load("game-panels.tsx", (id) => {
    if (id === "./room-permissions") return { useRoomPermissions: () => ({ role, currentUserId: role, loading: false }) };
    if (id === "@/lib/supabase/client") return { supabase: {} };
    if (id === "./gm-screen-settings") return require("./gm-screen-settings.ts");
    return require(id);
  }) as { default: ComponentType<{ panels: Panel[] }> };
  const Placeholder = () => null;
  const { default: Room } = load("page.tsx", (id) => {
    if (id === "react/jsx-runtime") return require(id);
    if (id === "./game-panels") return { __esModule: true, default: GamePanels };
    return new Proxy({}, { get: (_, key) => key === "__esModule" ? true : Placeholder });
  }) as { default: (props: { searchParams: Promise<{ roomId: string }> }) => Promise<ReactNode> };
  const tree = await Room({ searchParams: Promise.resolve({ roomId: "room" }) });
  function find(node: ReactNode): Panel[] | undefined {
    for (const child of Children.toArray(node)) {
      if (!isValidElement<{ panels?: Panel[]; children?: ReactNode }>(child)) continue;
      if (child.type === GamePanels) return child.props.panels;
      const found = find(child.props.children);
      if (found) return found;
    }
  }
  const panels = find(tree);
  assert.ok(panels);
  return {
    panels,
    html: renderToStaticMarkup(createElement(GamePanels, { panels: panels.map((panel) => ({
      ...panel, content: createElement("textarea", { "data-panel": panel.id, defaultValue: "미저장 입력" }),
    })) })),
  };
}

for (const role of ["master", "player", "spectator"]) {
  test(`${role}: 실제 룸 기본 순서는 채팅·주사위·시트가 준비 패널보다 앞선다`, async () => {
    const { panels, html } = await roomPanels(role);
    assert.deepEqual(Array.from(panels, (panel) => panel.id), [
      "chat", "dice", "character-sheets", "map-registration", "participants", "feature-permissions", "jukebox",
    ]);
    const ids = ["chat", "dice", "character-sheets", "map-registration", "participants", "jukebox"];
    for (let index = 1; index < ids.length; index++) {
      assert.ok(html.indexOf(`data-panel="${ids[index - 1]}"`) < html.indexOf(`data-panel="${ids[index]}"`));
    }
    if (role === "master") {
      for (const id of ids) {
        assert.match(html, new RegExp(`id="gm-panel-${id}"${ids.indexOf(id) >= 3 ? ' hidden=""' : '>'}`));
      }
    } else {
      assert.equal((html.match(/<details class="preparation-panel">/g) ?? []).length, 3);
      for (const title of ["맵 등록", "참가자", "주크박스"]) assert.ok(html.includes(`<summary>${title}</summary>`));
      assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|>)/);
      assert.doesNotMatch(html, /data-panel="feature-permissions"/);
      assert.equal((html.match(/미저장 입력/g) ?? []).length, 6);
    }
  });
}
