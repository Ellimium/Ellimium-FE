import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import type { ReactElement } from "react";
import ts from "typescript";

type TestNode = {
  hidden: boolean; open: boolean;
  closest(selector: string): unknown;
  focus(options: { preventScroll: boolean }): void;
  scrollIntoView(options: { block: string }): void;
  querySelector(selector: string): TestNode | null;
};

function setup() {
  const require = createRequire(import.meta.url);
  const events: string[] = [];
  let notice = "";
  function node(id: string, hidden = false, parent?: TestNode): TestNode {
    return {
      hidden, open: false,
      closest(selector: string): unknown {
        return selector === ".gm-panel" ? parent ?? null : hidden || parent?.hidden ? this : null;
      },
      focus(options: { preventScroll: boolean }) { assert.equal(options.preventScroll, true); events.push(`${id}:focus`); },
      scrollIntoView(options: { block: string }) { assert.equal(options.block, "start"); events.push(`${id}:scroll`); },
      querySelector: (_: string): TestNode | null => null,
    };
  }
  const nodes = new Map<string, TestNode>();
  let settings: TestNode | null = null;
  const module = { exports: {} as { default: () => ReactElement<{ children: ReactElement<{ onClick: () => void; children: string }>[] }> } };
  const source = readFileSync(new URL("room-quick-navigation.tsx", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, {
    module, exports: module.exports,
    document: { getElementById: (id: string) => nodes.get(id) ?? null, querySelector: () => settings },
    require: (id: string) => id === "react"
      ? { useState: () => [notice, (value: string) => { notice = value; }] }
      : require(id),
  });
  return {
    node, nodes, events,
    setSettings(value: TestNode) { settings = value; },
    click(index: number) { module.exports.default().props.children[index].props.onClick(); },
    notice: () => notice,
  };
}

test("바로가기는 콘텐츠를 교체하지 않고 목적지로 포커스·스크롤만 이동한다", () => {
  const h = setup();
  for (const [index, id] of ["room-map", "room-chat", "room-character-sheets"].entries()) {
    const target = h.node(id);
    h.nodes.set(id, target);
    h.click(index);
    assert.equal(h.nodes.get(id), target);
    assert.deepEqual(h.events.splice(0), [`${id}:focus`, `${id}:scroll`]);
    assert.equal(h.notice(), "");
  }
});

test("채팅이 숨김·접힘이면 펼쳐진 주사위로 이동하고 기존 설정을 건드리지 않는다", () => {
  for (const hidden of [false, true]) {
    const h = setup();
    const parent = h.node("chat-heading", hidden);
    h.nodes.set("room-chat", h.node("chat", true, parent));
    h.nodes.set("room-dice", h.node("dice"));
    h.click(1);
    assert.deepEqual(h.events, ["dice:focus", "dice:scroll"]);
    assert.equal(parent.hidden, hidden);
  }
});

test("접힌 시트는 GM 제목으로 안내하며 접힘을 해제하지 않는다", () => {
  const h = setup();
  const parent = h.node("sheet-heading");
  const content = h.node("sheet", true, parent);
  h.nodes.set("room-character-sheets", content);
  h.click(2);
  assert.deepEqual(h.events, ["sheet-heading:focus", "sheet-heading:scroll"]);
  assert.equal(content.hidden, true);
  assert.match(h.notice(), /접혀 있습니다/);
});

test("모두 숨긴 대화는 GM 설정을 열고 안내하며 숨김을 해제하지 않는다", () => {
  const h = setup();
  const parent = h.node("hidden-heading", true);
  h.nodes.set("room-chat", h.node("chat", false, parent));
  h.nodes.set("room-dice", h.node("dice", false, parent));
  const settings = h.node("settings");
  settings.querySelector = () => h.node("settings-summary");
  h.setSettings(settings);
  h.click(1);
  assert.equal(settings.open, true);
  assert.equal(parent.hidden, true);
  assert.deepEqual(h.events, ["settings-summary:focus", "settings:scroll"]);
  assert.match(h.notice(), /숨겨져 있습니다/);
});

test("아직 목적지가 없으면 다른 패널을 열지 않고 로딩 안내를 제공한다", () => {
  const h = setup();
  h.click(2);
  assert.deepEqual(h.events, []);
  assert.match(h.notice(), /불러온 뒤/);
});
