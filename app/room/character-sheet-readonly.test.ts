import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { SheetTab } from "./character-sheet-drafts.ts";

// Render the real component with loaded state; no network or browser hooks are needed.
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("character-sheets.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const sheet = {
  id: "sheet-a", owner_id: "player-a", name: "엘리온", system: "dnd_5e",
  attributes: { STR: 16, 직업: "탐정" }, resources: { HP: 0, MP: { current: 4, max: 6 } },
  skills: { 운동: 5 }, equipment: ["장검", { name: "물약", quantity: 2 }],
  notes: "첫 줄\n  <script>메모</script>", backstory: "북쪽 변경 출신.",
};

function renderSheet(role: string, userId: string, tab: SheetTab, sheets = [sheet], checking = false, loadedRole = role) {
  const states = [false, "public", loadedRole, sheets, { "sheet-a": tab },
    { "sheet-a": { notes: { notes: "미저장 초안" } } }, "dnd_5e", false, false, "", "", ""];
  let stateIndex = 0;
  const exports: { default?: React.ComponentType<{ roomId: string }> } = {};
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === "react") return { ...React, useState: () => [states[stateIndex++], () => {}], useRef: () => ({ current: false }), useEffect: () => {} };
      if (name === "./room-permissions") return { useRoomPermissions: () => ({ role, currentUserId: userId, checking, error: "", canUse: () => true, loading: false }) };
      if (name === "@/lib/supabase/client") return { supabase: {} };
      return require(name.startsWith("./") ? `${name}.ts` : name);
    },
  });
  return renderToStaticMarkup(React.createElement(exports.default!, { roomId: "room-a" }));
}

function textarea(html: string, field: string) {
  const match = html.match(new RegExp(`<textarea([^>]*)name="${field}"([^>]*)>([\\s\\S]*?)</textarea>`));
  assert.ok(match, `${field} must be displayed`);
  return { attributes: match[1] + match[2], value: match[3] };
}

test("비소유자에게 모든 탭의 저장값을 읽기 전용으로 표시하고 편집·굴림을 막는다", () => {
  const fields: Record<SheetTab, Record<string, string>> = {
    attributes: { attributes: "STR=16\n직업=탐정", resources: 'HP=0\nMP={&quot;current&quot;:4,&quot;max&quot;:6}' },
    skills: { skills: "운동=5" }, equipment: { equipment: '장검\n{&quot;name&quot;:&quot;물약&quot;,&quot;quantity&quot;:2}' },
    notes: { notes: "첫 줄\n  &lt;script&gt;메모&lt;/script&gt;", backstory: "북쪽 변경 출신." },
  };
  for (const [tab, values] of Object.entries(fields)) {
    const html = renderSheet("player", "player-b", tab as SheetTab);
    for (const [field, value] of Object.entries(values)) {
      assert.equal(textarea(html, field).value, value);
      assert.match(textarea(html, field).attributes, /readOnly=""/);
    }
    assert.doesNotMatch(html, /변경 저장|변경 취소|미저장 초안|<script>/);
    const rollButtons = [...html.matchAll(/<button[^>]*aria-label="[^"]*검사 굴리기"[^>]*>/g)];
    assert.equal(rollButtons.length, tab === "attributes" ? 1 : 0);
    for (const button of rollButtons) assert.match(button[0], /disabled=""/);
  }
});

test("소유자와 마스터의 입력·저장·굴림 UI를 유지한다", () => {
  for (const [role, userId] of [["player", "player-a"], ["master", "master-a"]]) {
    for (const tab of ["attributes", "skills", "equipment", "notes"] as const) {
      const html = renderSheet(role, userId, tab);
      assert.doesNotMatch(html, /readOnly=""/);
      assert.match(html, /변경 저장/);
      assert.match(html, /변경 취소/);
      if (tab === "notes") assert.equal(textarea(html, "notes").value, "미저장 초안");
      const rollButtons = [...html.matchAll(/<button[^>]*aria-label="[^"]*검사 굴리기"[^>]*>/g)];
      assert.equal(rollButtons.length, tab === "attributes" ? 1 : 0);
      for (const button of rollButtons) assert.doesNotMatch(button[0], /disabled=""/);
    }
  }
});

test("RLS가 반환하지 않은 다른 시트나 관전자용 데이터를 생성하지 않는다", () => {
  for (const role of ["player", "spectator"]) {
    const html = renderSheet(role, "player-b", "attributes", []);
    assert.doesNotMatch(html, /엘리온|STR=16|name="resources"|검사 굴리기|변경 저장/);
  }
});


test("재조회 중에도 미저장 초안은 유지하고 저장·굴림은 비활성화한다", () => {
  const html = renderSheet("player", "player-a", "notes", [sheet], true);
  assert.equal(textarea(html, "notes").value, "미저장 초안");
  assert.match(textarea(html, "notes").attributes, /readOnly=""/);
  for (const button of html.matchAll(/<button[^>]*>(변경 저장|변경 취소|시트 생성)<\/button>/g)) {
    assert.match(button[0], /disabled=""/);
  }
});

test("역할 변경 직후에는 이전 역할로 조회한 시트 데이터를 표시하지 않는다", () => {
  const html = renderSheet("spectator", "player-a", "notes", [sheet], false, "player");
  assert.doesNotMatch(html, /엘리온|미저장 초안|변경 저장/);
});
