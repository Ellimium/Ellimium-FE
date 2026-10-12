import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import ts from "typescript";

import { getAuthErrorMessage } from "./auth-errors.ts";
import { getSafeReturnPath } from "./return-path.ts";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("page.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
type Props = {
  children?: React.ReactNode;
  type?: string;
  name?: string;
  disabled?: boolean;
  onClick?: () => void;
  onSubmit?: (event: unknown) => Promise<void>;
};

function find(tree: React.ReactNode, predicate: (node: React.ReactElement<Props>) => boolean): React.ReactElement<Props> | undefined {
  if (!React.isValidElement<Props>(tree)) return;
  if (predicate(tree)) return tree;
  for (const child of React.Children.toArray(tree.props.children)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}

function harness(search = "?returnTo=%2Froom%3FroomId%3Dtest") {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effect = () => {};
  let request = async (): Promise<{ error: unknown }> => ({ error: null });
  const calls: { name: string; email?: string; redirectTo?: string }[] = [];
  const destinations: string[] = [];
  const exports: { default?: () => React.ReactElement } = {};
  runInNewContext(compiled, {
    exports, URLSearchParams,
    window: { location: { origin: "http://localhost:3000", search } },
    FormData: class { get(name: string) { return ({ email: "player@example.com", password: "password", nickname: "모험가" } as Record<string, string>)[name]; } },
    require: (name: string) => {
      if (name === "react") return { ...React,
        useEffect: (fn: () => void) => { effect = fn; },
        useState: (initial: unknown) => {
          const i = stateIndex++;
          if (!(i in states)) states[i] = initial;
          return [states[i], (value: unknown) => { states[i] = value; }];
        },
        useRef: (initial: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
      };
      if (name === "next/link") return "a";
      if (name === "next/navigation") return { useRouter: () => ({ replace: (url: string) => destinations.push(url), refresh: () => {} }) };
      if (name === "./auth-errors") return { getAuthErrorMessage };
      if (name === "./return-path") return { getSafeReturnPath };
      if (name === "@/lib/supabase/client") return { supabase: { auth: {
        resetPasswordForEmail: (email: string, options: { redirectTo: string }) => {
          calls.push({ name: "recovery", email, redirectTo: options.redirectTo }); return request();
        },
        signInWithPassword: async () => { calls.push({ name: "login" }); return { error: null, data: { session: {} } }; },
        signUp: async () => { calls.push({ name: "signup" }); return { error: null, data: { session: null } }; },
      } } };
      return require(name);
    },
  });
  function render() { stateIndex = refIndex = 0; return exports.default!(); }
  function click(label: string) {
    find(render(), (node) => node.type === "button" && node.props.children === label)!.props.onClick!();
  }
  function submit(tree = render()) {
    return find(tree, (node) => node.type === "form")!.props.onSubmit!({ preventDefault() {}, currentTarget: {} });
  }
  return { render, click, submit, calls, destinations, mount: () => { render(); effect(); },
    request: (next: typeof request) => { request = next; },
    markup: () => renderToStaticMarkup(render()),
  };
}

test("복구 진입점은 이메일만 요청하고 로그인으로 돌아갈 수 있다", () => {
  const h = harness();
  h.click("비밀번호를 잊으셨나요?");
  const markup = h.markup();
  assert.match(markup, /비밀번호 복구/);
  assert.match(markup, /type="email".*required/);
  assert.doesNotMatch(markup, /name="password"|name="nickname"/);
  h.click("로그인");
  assert.match(h.markup(), /name="password"/);
});

test("만료 링크의 재요청 경로는 복구 모드로 바로 진입한다", () => {
  const h = harness("?mode=recovery"); h.mount();
  assert.match(h.markup(), /비밀번호 복구/);
  assert.doesNotMatch(h.markup(), /name="password"/);
});

test("복구 요청은 현재 origin의 변경 화면을 지정하고 계정 존재를 드러내지 않는다", async () => {
  const h = harness(); h.click("비밀번호를 잊으셨나요?");
  await h.submit();
  assert.deepEqual(h.calls, [{ name: "recovery", email: "player@example.com", redirectTo: "http://localhost:3000/login/reset-password" }]);
  assert.match(h.markup(), /role="status".*등록된 계정이 있다면/);
  assert.equal(h.destinations.length, 0);
  h.click("로그인");
  assert.doesNotMatch(h.markup(), /role="status"/);
});

test("요청 중 중복 제출과 모드 전환을 차단하고 완료 후 다시 요청할 수 있다", async () => {
  const h = harness(); h.click("비밀번호를 잊으셨나요?");
  let done!: (result: { error: null }) => void;
  h.request(() => new Promise((resolve) => { done = resolve; }));
  const tree = h.render();
  const pending = h.submit(tree);
  await h.submit(tree);
  h.click("로그인");
  assert.equal(h.calls.length, 1);
  assert.match(h.markup(), /비밀번호 복구/);
  assert.equal(find(h.render(), (node) => node.props.type === "submit")!.props.disabled, true);
  done({ error: null }); await pending;
  assert.equal(find(h.render(), (node) => node.props.type === "submit")!.props.disabled, false);
  h.request(async () => ({ error: null })); await h.submit();
  assert.equal(h.calls.length, 2);
});

test("요청 제한·네트워크·예상 밖 오류는 안전한 안내를 표시하고 재시도를 허용한다", async () => {
  const cases = [
    { error: new AuthApiError("private@example.com", 429, "over_email_send_rate_limit"), text: /잠시 기다린/ },
    { error: new AuthRetryableFetchError("Failed to fetch", 0), text: /인터넷 연결/ },
    { error: new AuthApiError("private@example.com", 400, "user_not_found"), text: /다시 시도/ },
    { error: new Error("private@example.com"), text: /다시 시도/, throws: true },
  ];
  for (const item of cases) {
    const h = harness(); h.click("비밀번호를 잊으셨나요?");
    h.request(async () => { if (item.throws) throw item.error; return { error: item.error }; });
    await h.submit();
    assert.match(h.markup(), /role="alert"/);
    assert.match(h.markup(), item.text);
    assert.doesNotMatch(h.markup(), /private@example.com|role="status"/);
    assert.equal(find(h.render(), (node) => node.props.type === "submit")!.props.disabled, false);
    h.request(async () => ({ error: null })); await h.submit();
    assert.doesNotMatch(h.markup(), /role="alert"/);
    assert.match(h.markup(), /role="status"/);
  }
});

test("로그인 복귀 경로와 가입 확인 안내는 유지한다", async () => {
  const login = harness(); await login.submit();
  assert.deepEqual(login.destinations, ["/room?roomId=test"]);
  const signup = harness(); signup.click("회원가입"); await signup.submit();
  assert.deepEqual(signup.calls, [{ name: "signup" }]);
  assert.match(signup.markup(), /확인 이메일의 링크/);
});
