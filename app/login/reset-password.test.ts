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
import { getRecoveryTokens } from "./reset-password/recovery-link.ts";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("reset-password/page.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
type Props = { children?: React.ReactNode; type?: string; disabled?: boolean; href?: string; onClick?: () => void; onSubmit?: (event: unknown) => Promise<void> };
function find(tree: React.ReactNode, predicate: (node: React.ReactElement<Props>) => boolean): React.ReactElement<Props> | undefined {
  if (!React.isValidElement<Props>(tree)) return;
  if (predicate(tree)) return tree;
  for (const child of React.Children.toArray(tree.props.children)) {
    const result = find(child, predicate); if (result) return result;
  }
}
const validHash = "#type=recovery&access_token=access&refresh_token=refresh";
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function harness(hash = validHash) {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let index = 0; let refIndex = 0;
  let effect = () => () => {};
  let password = "new-password"; let confirmation = password;
  let resets = 0;
  let initializationRequest = async (): Promise<void> => {};
  const clients: { disposed: boolean; pending: number }[] = [];
  const visibilityListeners = new Set<object>();
  let sessionRequest = async (): Promise<{ data: { session: object | null }; error: unknown }> => ({ data: { session: {} }, error: null });
  let updateRequest = async (): Promise<{ error: unknown }> => ({ error: null });
  const sessions: unknown[] = []; const updates: unknown[] = []; const options: unknown[] = []; const urls: string[] = [];
  const location = { hash, pathname: "/login/reset-password", search: "" };
  let onHashChange = () => {};
  const exports: { default?: () => React.ReactElement } = {};
  runInNewContext(compiled, {
    exports, URLSearchParams,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" } },
    window: { location, history: { state: null, replaceState: (_state: unknown, _title: string, url: string) => { urls.push(url); location.hash = ""; } },
      addEventListener: (_name: string, fn: () => void) => { onHashChange = fn; },
      removeEventListener: () => { onHashChange = () => {}; },
    },
    FormData: class { get(name: string) { return name === "password" ? password : confirmation; } },
    require: (name: string) => {
      if (name === "react") return { ...React,
        useState: (initial: unknown) => { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], (value: unknown) => { states[i] = value; }]; },
        useRef: (initial: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
        useEffect: (fn: typeof effect) => { effect = fn; },
      };
      if (name === "next/link") return "a";
      if (name === "../auth-errors") return { getAuthErrorMessage };
      if (name === "./recovery-link") return { getRecoveryTokens };
      if (name === "@supabase/supabase-js") return { AuthClient: function(config: unknown) {
        options.push(config);
        const client = { disposed: false, pending: 0 };
        clients.push(client);
        const initialized = initializationRequest().then(() => { visibilityListeners.add(client); });
        async function request<T>(callback: () => Promise<T>) {
          client.pending++;
          try { await initialized; return await callback(); }
          finally { client.pending--; }
        }
        return {
          getSession: () => initialized,
          setSession: (tokens: unknown) => { sessions.push(tokens); return request(sessionRequest); },
          updateUser: (data: unknown) => { updates.push(data); return request(updateRequest); },
          dispose: async () => {
            assert.equal(client.pending, 0, "dispose must wait for pending auth requests");
            visibilityListeners.delete(client);
            client.disposed = true;
          },
        };
      } };
      return require(name);
    },
  });
  function render() { index = refIndex = 0; return exports.default!(); }
  async function mount() { render(); const cleanup = effect(); await settle(); return cleanup; }
  function submit(tree = render()) { return find(tree, node => node.type === "form")!.props.onSubmit!({ preventDefault() {}, currentTarget: { reset() { resets++; } } }); }
  function retry() { find(render(), node => node.props.children === "복구 링크 다시 확인")!.props.onClick!(); }
  return { mount, render, submit, retry, sessions, updates, options, urls, clients, visibilityListeners,
    navigate: async (hash: string) => { location.hash = hash; onHashChange(); await settle(); },
    markup: () => renderToStaticMarkup(render()),
    password: (value: string, confirm = value) => { password = value; confirmation = confirm; },
    sessionRequest: (fn: typeof sessionRequest) => { sessionRequest = fn; },
    updateRequest: (fn: typeof updateRequest) => { updateRequest = fn; },
    initializationRequest: (fn: typeof initializationRequest) => { initializationRequest = fn; },
    get resets() { return resets; },
  };
}

test("직접 방문·일반 로그인 링크·만료 링크·누락 토큰은 세션이나 변경 요청 없이 재요청 경로를 표시한다", async () => {
  for (const hash of ["", "#type=signup&access_token=a&refresh_token=r", "#type=recovery&access_token=a", validHash + "&error_code=otp_expired", validHash + "&error_description=private"]) {
    const h = harness(hash); await h.mount();
    assert.equal(h.sessions.length, 0); assert.equal(h.updates.length, 0);
    assert.match(h.markup(), /role="alert".*만료/);
    assert.match(h.markup(), /href="\/login\?mode=recovery"/);
    assert.doesNotMatch(h.markup(), /name="password"|private/);
    assert.deepEqual(h.urls, ["/login/reset-password"]);
  }
});

test("복구 토큰은 SDK에서 검증하고 기존 로그인 저장소와 분리한다", async () => {
  const h = harness(); await h.mount();
  assert.equal(JSON.stringify(h.sessions), JSON.stringify([{ access_token: "access", refresh_token: "refresh" }]));
  assert.equal(JSON.stringify(h.options), JSON.stringify([{
    url: "http://127.0.0.1:54321/auth/v1", headers: { apikey: "anon", Authorization: "Bearer anon" },
    persistSession: false, detectSessionInUrl: false, autoRefreshToken: false,
  }]));
  assert.match(h.markup(), /name="password"/);
  assert.deepEqual(h.urls, ["/login/reset-password"]);
});

test("SDK가 거절한 복구 세션은 변경 화면을 열지 않는다", async () => {
  const h = harness();
  h.sessionRequest(async () => ({ data: { session: null }, error: new AuthApiError("invalid token", 400, "bad_jwt") }));
  await h.mount();
  assert.match(h.markup(), /만료되었거나 올바르지/);
  assert.doesNotMatch(h.markup(), /name="password"/);
});

test("세션 확인의 네트워크 실패는 토큰을 URL에 복원하지 않고 다시 확인할 수 있다", async () => {
  for (const throws of [false, true]) {
    const h = harness();
    h.sessionRequest(async () => { const error = new AuthRetryableFetchError("offline", 0); if (throws) throw error; return { data: { session: null }, error }; });
    await h.mount();
    assert.match(h.markup(), /인터넷 연결/);
    h.sessionRequest(async () => ({ data: { session: {} }, error: null }));
    h.retry(); await settle();
    assert.equal(h.sessions.length, 2); assert.match(h.markup(), /name="password"/);
    assert.deepEqual(h.urls, ["/login/reset-password"]);
  }
});

test("비밀번호 길이와 확인 값은 변경 요청 전에 검사한다", async () => {
  const h = harness(); await h.mount();
  h.password("short"); await h.submit(); assert.match(h.markup(), /6자 이상/);
  h.password("long-enough", "different"); await h.submit(); assert.match(h.markup(), /일치하지/);
  assert.equal(h.updates.length, 0);
});

test("변경 중 중복 제출은 차단하고 성공하면 입력과 토큰을 비우고 로그인 링크를 제공한다", async () => {
  const h = harness(); await h.mount();
  let done!: (result: { error: null }) => void;
  h.updateRequest(() => new Promise(resolve => { done = resolve; }));
  const tree = h.render(); const pending = h.submit(tree); await h.submit(tree);
  assert.equal(h.updates.length, 1);
  assert.equal(find(h.render(), node => node.props.type === "submit")!.props.disabled, true);
  done({ error: null }); await pending;
  assert.equal(h.resets, 1); assert.match(h.markup(), /비밀번호를 변경했습니다/);
  assert.match(h.markup(), /href="\/login"/); assert.doesNotMatch(h.markup(), /name="password"/);
  assert.equal(JSON.stringify(h.updates), JSON.stringify([{ password: "new-password" }]));
  await settle();
  assert.equal(h.clients[0].disposed, true);
  assert.equal(h.visibilityListeners.size, 0);
});

test("변경 오류는 재시도할 수 있고 세션 만료는 메일 재요청으로 안내한다", async () => {
  for (const [code, status, expected] of [["weak_password", 422, /더 안전한 비밀번호/], ["same_password", 400, /기존 비밀번호와 다른/], ["over_request_rate_limit", 429, /잠시 기다린/]] as const) {
    const h = harness(); await h.mount();
    h.updateRequest(async () => ({ error: new AuthApiError("private", status, code) }));
    await h.submit(); assert.match(h.markup(), expected); assert.doesNotMatch(h.markup(), /private/);
    h.updateRequest(async () => ({ error: null })); await h.submit(); assert.match(h.markup(), /비밀번호를 변경했습니다/);
  }
  const expired = harness(); await expired.mount();
  expired.updateRequest(async () => ({ error: new AuthApiError("expired", 401, "session_not_found") }));
  await expired.submit(); assert.match(expired.markup(), /만료/); assert.doesNotMatch(expired.markup(), /name="password"/);
  const offline = harness(); await offline.mount();
  offline.updateRequest(async () => { throw new AuthRetryableFetchError("offline", 0); });
  await offline.submit(); assert.match(offline.markup(), /인터넷 연결/);
  assert.equal(find(offline.render(), node => node.props.type === "submit")!.props.disabled, false);
});

test("Strict Mode 재실행과 이전 검증 응답은 화면 상태를 덮어쓰지 않는다", async () => {
  const h = harness();
  let done!: (result: { data: { session: null }; error: AuthApiError }) => void;
  h.sessionRequest(() => new Promise(resolve => { done = resolve; }));
  const cleanup = await h.mount(); cleanup();
  h.sessionRequest(async () => ({ data: { session: {} }, error: null })); await h.mount();
  done({ data: { session: null }, error: new AuthApiError("invalid", 400, "bad_jwt") }); await settle();
  assert.equal(h.sessions.length, 2); assert.match(h.markup(), /name="password"/);
});

test("같은 탭에서 만료 링크를 열면 이전 세션을 사용하지 않고 새 링크를 검사한다", async () => {
  const h = harness(); await h.mount();
  await h.navigate("#error=access_denied&error_code=otp_expired");
  assert.match(h.markup(), /만료되었거나 올바르지/);
  assert.doesNotMatch(h.markup(), /name="password"/);
  assert.equal(h.sessions.length, 1);
  await h.navigate(validHash);
  assert.equal(h.sessions.length, 2); assert.match(h.markup(), /name="password"/);
});

test("링크 전환 전의 세션 확인·변경 응답은 새 링크의 오류 상태를 덮어쓰지 않는다", async () => {
  const checking = harness();
  let sessionDone!: (result: { data: { session: object }; error: null }) => void;
  checking.sessionRequest(() => new Promise(resolve => { sessionDone = resolve; }));
  await checking.mount(); await checking.navigate("#error_code=otp_expired");
  sessionDone({ data: { session: {} }, error: null }); await settle();
  assert.match(checking.markup(), /만료/); assert.doesNotMatch(checking.markup(), /name="password"/);
  const updating = harness(); await updating.mount();
  let updateDone!: (result: { error: null }) => void;
  updating.updateRequest(() => new Promise(resolve => { updateDone = resolve; }));
  const pending = updating.submit(); await updating.navigate("#error_code=otp_expired");
  updateDone({ error: null }); await pending;
  assert.match(updating.markup(), /만료/); assert.doesNotMatch(updating.markup(), /비밀번호를 변경했습니다/);
});

test("반복 링크 교체와 화면 종료 후에는 이전 클라이언트 리스너가 남지 않는다", async () => {
  const h = harness(); const cleanup = await h.mount();
  for (let i = 0; i < 3; i++) {
    await h.navigate(validHash);
    assert.equal(h.visibilityListeners.size, 1);
    assert.ok(h.clients.slice(0, -1).every(client => client.disposed));
  }
  cleanup(); await settle();
  assert.equal(h.visibilityListeners.size, 0);
  assert.ok(h.clients.every(client => client.disposed));
});

test("늦은 초기화 중 종료해도 초기화가 등록한 리스너를 정리한다", async () => {
  const h = harness("");
  let initialized!: () => void;
  h.initializationRequest(() => new Promise(resolve => { initialized = resolve; }));
  const cleanup = await h.mount(); cleanup(); await settle();
  assert.equal(h.clients[0].disposed, false);
  initialized(); await settle();
  assert.equal(h.clients[0].disposed, true);
  assert.equal(h.visibilityListeners.size, 0);
});

test("Strict Mode의 이전 초기화·세션 요청이 끝나면 이전 클라이언트만 정리한다", async () => {
  const h = harness();
  let initialized!: () => void;
  h.initializationRequest(() => new Promise(resolve => { initialized = resolve; }));
  const cleanup = await h.mount(); cleanup();
  h.initializationRequest(async () => {});
  const finalCleanup = await h.mount();
  initialized(); await settle();
  assert.equal(h.clients[0].disposed, true);
  assert.equal(h.clients[1].disposed, false);
  assert.equal(h.visibilityListeners.size, 1);
  assert.match(h.markup(), /name="password"/);
  finalCleanup(); await settle(); assert.equal(h.visibilityListeners.size, 0);
});

test("세션·변경 요청 성공 또는 예외가 늦게 끝나도 종료된 클라이언트를 정리한다", async () => {
  for (const throws of [false, true]) {
    for (const operation of ["session", "update"]) {
      const h = harness();
      let finished!: () => void;
      const delayed = async () => {
        await new Promise<void>(resolve => { finished = resolve; });
        if (throws) throw new AuthRetryableFetchError("offline", 0);
        return { data: { session: {} }, error: null };
      };
      if (operation === "session") h.sessionRequest(delayed);
      const cleanup = await h.mount();
      let submission: Promise<void> | undefined;
      if (operation === "update") { h.updateRequest(delayed); submission = h.submit(); }
      cleanup(); await settle();
      assert.equal(h.clients[0].disposed, false);
      finished(); await submission; await settle();
      assert.equal(h.clients[0].disposed, true);
      assert.equal(h.visibilityListeners.size, 0);
      assert.doesNotMatch(h.markup(), /비밀번호를 변경했습니다/);
    }
  }
});
