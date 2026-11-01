import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

test("lobby renders RLS-filtered rooms with identified links and explicit states", () => {
  const source = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

  assert.match(source, /from\("rooms"\)/);
  assert.match(source, /href={`\/room\?roomId=\$\{room\.id\}`}>/);
  assert.doesNotMatch(source, /href="\/room"/);
  assert.match(source, /캠페인을 불러오는 중/);
  assert.match(source, /캠페인 목록을 불러오지 못했습니다/);
  assert.match(source, /참여 중인 캠페인이 없습니다/);
});

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("page.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
type Result = { data: { id: string; name: string; description: null; game_system: string }[] | null; error: object | null };
type ButtonProps = { children?: React.ReactNode; onClick?: () => void; disabled?: boolean };
function retryButton(tree: React.ReactNode): React.ReactElement<ButtonProps> | undefined {
  if (!React.isValidElement<ButtonProps>(tree)) return;
  if (tree.type === "button") return tree;
  for (const child of React.Children.toArray(tree.props.children)) {
    const button = retryButton(child);
    if (button) return button;
  }
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function lobbyHarness() {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let index = 0; let refIndex = 0; let writes = 0;
  let effect = () => () => {};
  const requests: { signal: AbortSignal; resolve: (result: Result) => void; reject: (error: Error) => void }[] = [];
  const exports = {} as { Lobby: () => React.ReactElement };
  runInNewContext(compiled + "\nexports.Lobby = Lobby;", {
    exports, AbortController, URLSearchParams, window: { location: { search: "" } },
    require: (name: string) => {
      if (name === "react") return { ...React,
        useState: (initial: unknown) => { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], (value: unknown) => { states[i] = value; writes++; }]; },
        useRef: (initial: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
        useCallback: (fn: unknown) => fn,
        useEffect: (fn: typeof effect) => { effect = fn; },
      };
      if (name === "@/lib/supabase/client") return { supabase: { from: () => ({ select: () => ({ order: () => ({
        abortSignal: (signal: AbortSignal) => new Promise<Result>((resolve, reject) => { requests.push({ signal, resolve, reject }); }),
      }) }) }) } };
      if (name === "./room/room-access") return { ROOM_ACCESS_ENDED_MESSAGE: "" };
      if (name === "next/link") return "a";
      if (name === "./auth-guard" || name === "./logout-button") return () => null;
      return require(name);
    },
  });
  function render() { index = refIndex = 0; return exports.Lobby(); }
  return { requests, render, mount: () => { render(); return effect(); },
    markup: () => renderToStaticMarkup(render()), get writes() { return writes; } };
}

test("목록 조회 실패 후 성공·빈 목록·반복 실패에도 재시도 상태를 올바르게 표시한다", async () => {
  for (const outcome of ["rooms", "empty", "error"] as const) {
    const h = lobbyHarness(); const cleanup = h.mount();
    h.requests[0].resolve({ data: null, error: {} }); await settle();
    assert.match(h.markup(), /role="alert"/);
    retryButton(h.render())!.props.onClick!();
    assert.equal(retryButton(h.render())!.props.disabled, true);
    assert.match(h.markup(), /role="status"/);
    h.requests[1].resolve({ data: outcome === "rooms" ? [{ id: "room-1", name: "복구된 캠페인", description: null, game_system: "CoC" }] : [], error: outcome === "error" ? {} : null });
    await settle();
    if (outcome === "error") {
      assert.equal(retryButton(h.render())!.props.disabled, false);
      assert.match(h.markup(), /role="alert"/);
    } else {
      assert.doesNotMatch(h.markup(), /role="alert"|다시 불러오기/);
      assert.match(h.markup(), outcome === "rooms" ? /복구된 캠페인/ : /참여 중인 캠페인이 없습니다/);
    }
    cleanup();
  }
});

test("예외로 실패해도 재시도할 수 있고 같은 렌더의 연속 클릭은 요청 하나만 보낸다", async () => {
  const h = lobbyHarness(); const cleanup = h.mount();
  h.requests[0].reject(new Error("offline")); await settle();
  const button = retryButton(h.render())!;
  button.props.onClick!(); button.props.onClick!();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ data: [], error: null }); await settle();
  assert.doesNotMatch(h.markup(), /role="alert"/);
  cleanup();
});

test("최초 조회·재시도 중 화면 이탈은 요청을 취소하고 늦은 응답의 상태 갱신을 막는다", async () => {
  for (const retry of [false, true]) {
    const h = lobbyHarness(); const cleanup = h.mount();
    if (retry) {
      h.requests[0].resolve({ data: null, error: {} }); await settle();
      retryButton(h.render())!.props.onClick!();
    }
    const pending = h.requests.at(-1)!;
    cleanup(); const writes = h.writes;
    assert.equal(pending.signal.aborted, true);
    pending.resolve({ data: [], error: null }); await settle();
    assert.equal(h.writes, writes);
    const secondCleanup = h.mount();
    assert.equal(h.requests.at(-1)!.signal.aborted, false);
    secondCleanup();
  }
});
