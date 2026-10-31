import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";
import { assetLabels } from "./asset-images.ts";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("./asset-picker.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const assets = ["aaaa", "bbbb"].map((id) => ({ id, category: "token", storage_path: `${id}.png`, thumbnail_storage_path: id === "bbbb" ? "thumb.png" : null }));

test("선택한 원본·썸네일만 조회하고 오래된 응답·실패·권한 확인 중 상태를 처리한다", async () => {
  const states: unknown[] = [];
  const requests: string[] = [];
  const pending: ((result: object) => void)[] = [];
  let index = 0;
  const form = new EventTarget();
  const effects: (() => (() => void) | undefined)[] = [];
  let effect!: () => (() => void) | undefined;
  const exports: { default?: (props: object) => React.ReactElement<{ children: React.ReactElement[] }> } = {};
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === "react") return {
      useRef: () => ({ current: { form } }),
      useState: (initial: unknown) => { const i = index++; if (!(i in states)) states[i] = initial;
        return [states[i], (value: unknown) => { states[i] = value; }]; },
      useEffect: (callback: typeof effect) => { effects.push(callback); effect = callback; },
    };
    if (name === "./asset-images") return { assetLabels };
    if (name === "./asset-image") return { default: () => null };
    if (name === "@/lib/supabase/client") return { supabase: { storage: { from: () => ({
      createSignedUrl: (path: string) => { requests.push(path); return new Promise((resolve) => pending.push(resolve)); },
    }) } } };
    return require(name);
  } });
  const render = (options = {}) => { index = 0; return exports.default!({ assets, name: "imageAssetId", label: "이미지", disabled: false, allowEmpty: true, ...options }); };
  const tree = render(); const select = (tree.props.children[0] as React.ReactElement<{ children: React.ReactElement[] }>).props.children[1] as React.ReactElement<{ value: string; name: string; disabled: boolean; onChange: (e: object) => void }>;
  assert.equal(select.props.name, "imageAssetId"); assert.equal(select.props.value, "");
  const disposeReset = effects[0]();
  effect(); assert.equal(requests.length, 0);
  select.props.onChange({ target: { value: "aaaa" } }); render(); const cleanup = effect();
  assert.deepEqual(requests, ["aaaa.png"]);
  select.props.onChange({ target: { value: "bbbb" } }); cleanup?.(); render(); effect();
  assert.deepEqual(requests, ["aaaa.png", "thumb.png"]);
  pending[0]({ data: { signedUrl: "stale" }, error: null }); await settle();
  assert.equal(states[1], undefined);
  pending[1]({ data: null, error: { message: "denied" } }); await settle();
  const failure = render(); const preview = failure.props.children[1] as React.ReactElement<{ children: React.ReactElement<{ src?: string }> }>;
  assert.equal(preview.props.children.props.src, undefined);
  const disabled = render({ disabled: true }); effect();
  assert.equal(((disabled.props.children[0] as React.ReactElement<{ children: React.ReactElement[] }>).props.children[1] as React.ReactElement<{ disabled: boolean }>).props.disabled, true);
  assert.equal(requests.length, 2);
  form.dispatchEvent(new Event("reset"));
  assert.equal(states[0], "");
  disposeReset?.();
});
