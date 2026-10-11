import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";
import type { DiceRollLog } from "./dice-log.ts";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("dice-roll.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
type Props = { children?: React.ReactNode; className?: string; ref?: { current: unknown }; onScroll?: (event: { currentTarget: unknown }) => void; "data-roll-id"?: string };
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
const roll = (id: number): DiceRollLog => ({
  id: String(id), room_id: "room", roller_id: id % 2 ? "alice" : "bob", visibility: "public",
  expression: `1d20 ${id}`, total: id, individual_results: [id],
  created_at: new Date(Date.UTC(2026, 9, 8, 0, 0, id)).toISOString(),
});
function harness() {
  const states: unknown[] = [];
  const setters: ((value: unknown) => void)[] = [];
  const refs: { current: unknown }[] = [];
  const deps: unknown[][] = [];
  const disposers: (void | (() => void))[] = [];
  const observers = new Set<() => void>();
  let stateIndex = 0, refIndex = 0, layoutIndex = 0;
  let layouts: { index: number; effect: () => void | (() => void) }[] = [];
  let nodes: React.ReactElement<Props>[] = [];
  let dirty = false, hidden = false, top = 0;
  const list = {
    scrollHeight: 0, clientHeight: 200,
    get scrollTop() { return hidden ? 0 : top; },
    set scrollTop(value: number) { if (!hidden) top = Math.max(0, Math.min(value, Math.max(0, list.scrollHeight - list.clientHeight))); },
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll() {
      return nodes.filter(({ props }) => props["data-roll-id"]).map(({ props }, i) => ({
        dataset: { rollId: props["data-roll-id"] },
        getBoundingClientRect: () => ({ top: i * 100 - list.scrollTop, bottom: (i + 1) * 100 - list.scrollTop }),
      }));
    },
  };
  const exports: { default?: (props: { roomId: string }) => React.ReactNode } = {};
  runInNewContext(compiled, {
    exports,
    ResizeObserver: class {
      private callback: () => void;
      constructor(callback: () => void) { this.callback = callback; }
      observe() { observers.add(this.callback); }
      disconnect() { observers.delete(this.callback); }
    },
    require: (name: string) => {
      if (name === "react") return { ...React,
        useState: (initial: unknown) => {
          const index = stateIndex++;
          if (!(index in states)) states[index] = initial;
          setters[index] = (next) => {
            const value = typeof next === "function" ? next(states[index]) : next;
            if (!Object.is(states[index], value)) dirty = true;
            states[index] = value;
          };
          return [states[index], setters[index]];
        },
        useRef: (current: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current }),
        useEffect: () => {}, useMemo: (factory: () => unknown) => factory(),
        useLayoutEffect: (effect: () => void | (() => void), nextDeps: unknown[]) => {
          const index = layoutIndex++;
          if (!deps[index] || nextDeps.some((value, i) => !Object.is(value, deps[index][i]))) layouts.push({ index, effect });
          deps[index] = nextDeps;
        },
      };
      if (name === "./room-permissions") return { useRoomPermissions: () => ({ role: "player", currentUserId: "me", loading: false, canUse: () => true }) };
      if (name === "./room-connection") return { useRecordConnection: () => ({ state: "ready", publish: () => {} }) };
      if (name === "@/lib/supabase/client") return { supabase: {} };
      return require(name.startsWith("./") ? `${name}.ts` : name);
    },
  });
  function render() {
    dirty = false; stateIndex = refIndex = layoutIndex = 0; layouts = [];
    nodes = elements(exports.default!({ roomId: "room" }));
    nodes.find(({ props }) => props.className === "messages dice-list")!.props.ref!.current = list;
    list.clientHeight = hidden ? 0 : 200;
    list.scrollHeight = hidden ? 0 : nodes.filter(({ props }) => props["data-roll-id"]).length * 100;
    list.scrollTop = list.scrollTop;
    for (const { index, effect } of layouts) { disposers[index]?.(); disposers[index] = effect(); }
    for (const resize of observers) resize();
    if (dirty) render();
  }
  render();
  return {
    list,
    load(rows: DiceRollLog[]) { setters[0]("player"); setters[1](rows); setters[9](false); render(); },
    update(rows: DiceRollLog[]) { setters[1](rows); render(); },
    scroll(value: number) { list.scrollTop = value; nodes.find(({ props }) => props.className === "messages dice-list")!.props.onScroll!({ currentTarget: list }); },
    sort(value: "asc" | "desc") { setters[6](value); render(); },
    filter(value: string) { setters[3](value); render(); },
    hidden(value: boolean) { hidden = value; render(); },
  };
}
const history = Array.from({ length: 10 }, (_, i) => roll(i));

test("최신순 초기 조회는 위에서 시작하고 새 굴림·과거 페이지 추가에도 읽던 메시지 위치를 유지한다", () => {
  const h = harness(); h.load(history); assert.equal(h.list.scrollTop, 0);
  h.scroll(250); h.update([...history, roll(10), roll(11)]);
  assert.equal(h.list.scrollTop, 450);
  h.update([roll(-2), roll(-1), ...history, roll(10), roll(11)]);
  assert.equal(h.list.scrollTop, 450);
});

test("오래된순에서 과거 페이지·누락 기록을 앞에 추가해도 읽던 메시지 위치를 유지한다", () => {
  const h = harness(); h.load(history); h.sort("asc"); h.scroll(250);
  h.update([roll(-2), roll(-1), ...history]); assert.equal(h.list.scrollTop, 450);
  h.update([roll(-2), roll(-1), history[0], roll(0.5), ...history.slice(1)]);
  assert.equal(h.list.scrollTop, 550);
});

test("정렬·검색 필터 변경은 새 결과의 처음으로 이동한다", () => {
  const h = harness(); h.load(history); h.scroll(250); h.sort("asc"); assert.equal(h.list.scrollTop, 0);
  h.scroll(250); h.filter("alice"); assert.equal(h.list.scrollTop, 0);
});

test("접힌 동안 받은 새 굴림은 펼칠 때 기존 읽던 메시지 위치를 복구한다", () => {
  const h = harness(); h.load(history); h.scroll(250); h.hidden(true);
  h.update([...history, roll(10), roll(11)]); h.hidden(false);
  assert.equal(h.list.scrollTop, 450);
});
