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
type Props = {
  children?: React.ReactNode;
  className?: string;
  ref?: { current: unknown };
  onScroll?: (event: { currentTarget: unknown }) => void;
  onClick?: () => void;
  "aria-pressed"?: boolean;
};
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
const message = (id: number, system = false): ChatMessage => ({
  id: String(id), room_id: "room", sender_id: "sender", character_id: null, character_name: null,
  mode: "general", content: String(id), message_type: system ? "system" : "chat",
  event_type: system ? "notification" : null, event_data: null,
  created_at: new Date(Date.UTC(2026, 9, 8, 0, 0, id)).toISOString(),
});

// Run the component's scroll handler and layout effects against a clamped DOM-like viewport.
function harness() {
  const states: unknown[] = [];
  const setters: ((value: unknown) => void)[] = [];
  const refs: { current: unknown }[] = [];
  const dependencies: unknown[][] = [];
  let stateIndex = 0, refIndex = 0, layoutIndex = 0;
  let layouts: (() => void)[] = [];
  let nodes: React.ReactElement<Props>[] = [];
  let top = 0;
  const list = {
    scrollHeight: 0, clientHeight: 200,
    get scrollTop() { return top; },
    set scrollTop(value: number) { top = Math.max(0, Math.min(value, list.scrollHeight - list.clientHeight)); },
  };
  const exports: { default?: (props: { roomId: string }) => React.ReactNode } = {};
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === "react") return { ...React,
        useState: (initial: unknown) => {
          const index = stateIndex++;
          if (!(index in states)) states[index] = initial;
          setters[index] = (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; };
          return [states[index], setters[index]];
        },
        useRef: (current: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current }),
        useEffect: () => {},
        useLayoutEffect: (effect: () => void, deps: unknown[]) => {
          const index = layoutIndex++;
          if (!dependencies[index] || deps.some((value, i) => !Object.is(value, dependencies[index][i]))) layouts.push(effect);
          dependencies[index] = deps;
        },
      };
      if (name === "./room-permissions") return { useRoomPermissions: () => ({
        role: "player", currentUserId: "me", members: [], loading: false, canUse: () => true,
      }) };
      if (name === "./room-connection") return { useRecordConnection: () => ({ state: "ready", publish: () => {} }) };
      if (name === "@/lib/supabase/client") return { supabase: {} };
      return require(name.startsWith("./") ? `${name}.ts` : name);
    },
  });
  function render() {
    stateIndex = refIndex = layoutIndex = 0;
    layouts = [];
    nodes = elements(exports.default!({ roomId: "room" }));
    const container = nodes.find(({ props }) => props.className === "messages chat-messages")!;
    container.props.ref!.current = list;
    list.scrollHeight = nodes.filter(({ type }) => type === "article").length * 100;
    list.scrollTop = list.scrollTop;
    for (const effect of layouts) effect();
  }
  render();
  return {
    list,
    load(messages: ChatMessage[]) { setters[0]("player"); setters[1](messages); setters[7](false); render(); },
    receive(messages: ChatMessage[]) { setters[1](messages); render(); },
    scroll(top: number) {
      list.scrollTop = top;
      nodes.find(({ props }) => props.className === "messages chat-messages")!.props.onScroll!({ currentTarget: list });
    },
    toggleSystem() { nodes.find(({ props }) => props["aria-pressed"] !== undefined)!.props.onClick!(); render(); },
  };
}

const history = Array.from({ length: 10 }, (_, i) => message(i));

test("초기 기록 로드는 최신 위치로 이동하고 과거 조회 중 큰 새 메시지가 와도 위치를 유지한다", () => {
  const h = harness();
  h.load(history);
  assert.equal(h.list.scrollTop, 800);
  h.scroll(200);
  h.receive([...history, message(10), message(11)]);
  assert.equal(h.list.scrollTop, 200);
  h.receive([...history, message(10), message(11), message(12)]);
  assert.equal(h.list.scrollTop, 200);
});

test("갱신 전 하단에서 48px 이내일 때만 자동 이동하고 직접 하단으로 돌아오면 다시 따라간다", () => {
  for (const distance of [0, 48, 49]) {
    const h = harness(); h.load(history); h.scroll(800 - distance);
    h.receive([...history, message(10), message(11)]);
    assert.equal(h.list.scrollTop, distance <= 48 ? 1000 : 751);
    h.scroll(1000);
    h.receive([...history, message(10), message(11), message(12)]);
    assert.equal(h.list.scrollTop, 1100);
  }
});

test("시스템 표시 전환은 과거 조회 위치를 유지하고 하단 조회 중에는 최신 위치를 유지한다", () => {
  const h = harness(); h.load([...history, message(10, true), message(11, true)]);
  h.scroll(200); h.toggleSystem();
  assert.equal(h.list.scrollTop, 200);
  h.toggleSystem();
  assert.equal(h.list.scrollTop, 200);
  h.scroll(1000); h.toggleSystem();
  assert.equal(h.list.scrollTop, 800);
  h.toggleSystem();
  assert.equal(h.list.scrollTop, 1000);
});

test("숨긴 시스템 메시지 수신은 과거 조회 위치를 유지하고 짧은 기록은 계속 하단을 따라간다", () => {
  const h = harness(); h.load(history); h.toggleSystem(); h.scroll(200);
  h.receive([...history, message(10, true)]);
  assert.equal(h.list.scrollTop, 200);
  const short = harness(); short.load([message(0)]);
  short.receive([message(0), message(1), message(2), message(3)]);
  assert.equal(short.list.scrollTop, 200);
});

test("시스템 메시지를 숨겨 스크롤이 하단으로 제한되면 다음 메시지부터 다시 따라간다", () => {
  const h = harness(); h.load([...history, message(10, true), message(11, true)]);
  h.scroll(900); h.toggleSystem();
  assert.equal(h.list.scrollTop, 800);
  h.receive([...history, message(10, true), message(11, true), message(12)]);
  assert.equal(h.list.scrollTop, 900);
});
