import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("participants.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
type Props = { children?: React.ReactNode; onClick?: (event: unknown) => void; onChange?: (event: unknown) => void; disabled?: boolean; "aria-label"?: string };

function find(tree: React.ReactNode, label: string): React.ReactElement<Props> | undefined {
  if (!React.isValidElement<Props>(tree)) return;
  if (tree.props["aria-label"] === label) return tree;
  for (const child of React.Children.toArray(tree.props.children)) {
    const result = find(child, label);
    if (result) return result;
  }
}

function harness() {
  const participants = [
    { user_id: "me", role: "master", nickname: "마스터", avatarUrl: "" },
    { user_id: "other", role: "player", nickname: "별빛", avatarUrl: "" },
  ];
  const states: unknown[] = [participants, false, "", ""];
  const refs: { current: unknown }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let focusEffect = () => {};
  let effectIndex = 0;
  let confirmed = false;
  let role = "master";
  let checking = false;
  let roomId: string | undefined = "room";
  let request = async (): Promise<{ error: { message: string } | null }> => ({ error: null });
  let refreshed = 0;
  let focused = 0;
  let sectionFocused = 0;
  const messages: string[] = [];
  const calls: { name: string; args: unknown }[] = [];
  const button = { isConnected: true, focus: () => { focused++; } };
  const exports: { default?: React.FunctionComponent<{ roomId?: string }> } = {};
  runInNewContext(compiled, {
    exports,
    window: { confirm: (message: string) => { messages.push(message); return confirmed; } },
    require: (name: string) => {
      if (name === "react") return { ...React,
        useState: () => {
          const i = stateIndex++;
          return [states[i], (value: unknown) => { states[i] = value; }];
        },
        useRef: (value: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
        useEffect: (callback: () => void) => { if (effectIndex++ === 0) focusEffect = callback; },
      };
      if (name === "./room-permissions") return { useRoomPermissions: () => ({
        members: participants, currentUserId: "me", role, checking, loading: false, error: "",
        refreshMembership: async () => { refreshed++; },
      }) };
      if (name === "@/lib/supabase/client") return { supabase: { rpc: (name: string, args: unknown) => {
        calls.push({ name, args }); return request();
      } } };
      return require(name);
    },
  });
  function render() {
    stateIndex = refIndex = effectIndex = 0;
    const tree = exports.default!({ roomId }) as React.ReactElement;
    refs[2].current = { focus: () => { sectionFocused++; } };
    focusEffect();
    return tree;
  }
  function remove(tree = render()) {
    find(tree, "별빛 강제 퇴장")!.props.onClick!({ currentTarget: button });
  }
  return {
    render, remove, button, messages, calls,
    confirm: () => { confirmed = true; },
    request: (next: typeof request) => { request = next; },
    role: (next: string) => { role = next; },
    checking: () => { checking = true; },
    noRoom: () => { roomId = undefined; },
    get error() { return states[2] as string; },
    get pending() { return states[3]; },
    get focused() { return focused; },
    get sectionFocused() { return sectionFocused; },
    get refreshed() { return refreshed; },
  };
}

test("퇴장 취소는 대상·동작을 확인하고 RPC 없이 버튼으로 포커스를 돌린다", async () => {
  const h = harness(); h.remove(); await settle();
  assert.match(h.messages[0], /별빛.*강제 퇴장/);
  assert.equal(h.calls.length, 0); assert.equal(h.refreshed, 0);
  assert.equal(h.pending, ""); assert.equal(h.focused, 1);
});

test("확인한 대상만 퇴장시키고 렌더 전 중복 클릭과 실행 중 역할 변경을 차단한다", async () => {
  const h = harness(); h.confirm();
  let done!: (result: { error: null }) => void;
  h.request(() => new Promise((resolve) => { done = resolve; }));
  const originalTree = h.render();
  h.remove(originalTree); h.remove(originalTree);
  find(originalTree, "별빛 역할")!.props.onChange!({ target: { value: "spectator" } });
  assert.equal(h.messages.length, 1); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, "force_remove_room_member");
  assert.equal(JSON.stringify(h.calls[0].args), JSON.stringify({ target_room_id: "room", target_user_id: "other" }));
  assert.equal(find(h.render(), "별빛 강제 퇴장")!.props.disabled, true);
  done({ error: null }); await settle();
  assert.equal(h.refreshed, 1); assert.equal(h.pending, "");
  h.button.isConnected = false; h.render();
  assert.equal(h.sectionFocused, 1);
});

test("RPC 오류·연결 실패는 대상과 오류를 표시하고 버튼 포커스·재시도를 복구한다", async () => {
  for (const throws of [false, true]) {
    const h = harness(); h.confirm();
    h.request(async () => {
      if (throws) throw new Error("offline");
      return { error: { message: "권한이 없습니다" } };
    });
    h.remove(); h.render(); await settle();
    assert.match(h.error, /별빛.*강제 퇴장 실패/);
    assert.match(h.error, throws ? /서버에 연결하지 못했습니다/ : /권한이 없습니다/);
    assert.equal(h.pending, ""); assert.equal(h.refreshed, 0);
    assert.match(renderToStaticMarkup(h.render()), /role="alert"/);
    assert.equal(h.focused, 2);
    h.request(async () => ({ error: null })); h.remove(); await settle();
    assert.equal(h.calls.length, 2); assert.equal(h.error, ""); assert.equal(h.refreshed, 1);
  }
});

test("마스터 외 사용자·권한 확인 중에는 퇴장 UI가 없고 자신·룸 미선택은 퇴장하지 않는다", async () => {
  for (const role of ["player", "spectator"]) {
    const h = harness(); h.role(role);
    assert.equal(find(h.render(), "별빛 강제 퇴장"), undefined);
  }
  const checking = harness(); checking.checking();
  assert.equal(find(checking.render(), "별빛 강제 퇴장"), undefined);
  const master = harness();
  assert.equal(find(master.render(), "마스터 강제 퇴장"), undefined);
  master.confirm(); master.noRoom(); master.remove(); await settle();
  assert.equal(master.messages.length, 0); assert.equal(master.calls.length, 0);
});
