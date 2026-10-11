import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";

import { getLoginHrefForPath } from "../login/return-path.ts";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("../auth-guard.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(getUser: () => Promise<{ data: { user: object | null } }>) {
  let effect: () => () => void = () => () => {};
  let authChanged: (event: string, session: object | null) => void = () => {};
  let ready = false;
  let unsubscribed = false;
  const location = { pathname: "/room", search: "?roomId=first", hash: "" };
  const redirects: string[] = [];
  const exports: { default?: React.FunctionComponent<{ children: React.ReactNode }> } = {};
  runInNewContext(compiled, {
    exports,
    window: { location },
    require: (name: string) => {
      if (name === "react") return { ...React,
        useState: () => [ready, (value: boolean) => { ready = value; }],
        useEffect: (callback: () => () => void) => { effect = callback; },
      };
      if (name === "next/navigation") return { useRouter: () => ({ replace: (url: string) => redirects.push(url) }) };
      if (name === "./login/return-path") return { getLoginHrefForPath };
      if (name === "@/lib/supabase/client") return { supabase: { auth: {
        getUser,
        onAuthStateChange: (callback: typeof authChanged) => {
          authChanged = callback;
          return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } };
        },
      } } };
      return require(name);
    },
  });
  exports.default!({ children: "protected content" });
  const cleanup = effect();
  return { location, redirects, cleanup, authChanged: (session: object | null) => authChanged("SIGNED_OUT", session),
    get ready() { return ready; }, get unsubscribed() { return unsubscribed; } };
}

for (const failure of ["no user", "request rejected"]) {
  test(`returns to the requested room when authentication fails: ${failure}`, async () => {
    const h = harness(async () => {
      if (failure === "request rejected") throw new Error("offline");
      return { data: { user: null } };
    });
    await settle();
    assert.equal(h.ready, false);
    assert.equal(new URL(h.redirects[0], "http://localhost").searchParams.get("returnTo"), "/room?roomId=first");
  });
}

test("keeps authenticated content visible and uses the current room when the session ends", async () => {
  const h = harness(async () => ({ data: { user: { id: "user" } } }));
  await settle();
  assert.equal(h.ready, true);
  assert.deepEqual(h.redirects, []);
  h.authChanged({ user: { id: "user" } });
  assert.deepEqual(h.redirects, []);
  h.location.search = "?roomId=second&tab=chat";
  h.location.hash = "#latest";
  h.authChanged(null);
  assert.equal(h.ready, false);
  assert.equal(new URL(h.redirects[0], "http://localhost").searchParams.get("returnTo"), "/room?roomId=second&tab=chat");
});

test("ignores late authentication results and events after unmount", async () => {
  let resolve!: (value: { data: { user: null } }) => void;
  const h = harness(() => new Promise((done) => { resolve = done; }));
  h.cleanup();
  resolve({ data: { user: null } });
  h.authChanged(null);
  await settle();
  assert.equal(h.unsubscribed, true);
  assert.deepEqual(h.redirects, []);
});
