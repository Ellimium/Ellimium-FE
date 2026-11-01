import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("./asset-image.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

test("깨진 이미지에는 대체 표시를 제공하고 URL이 변경되면 새 이미지를 표시한다", () => {
  let failedSrc: string | undefined;
  const exports: { default?: (props: { src?: string; alt: string }) => React.ReactElement<Record<string, unknown>> } = {};
  runInNewContext(compiled, { exports, require: (name: string) => name === "react"
    ? { useState: () => [failedSrc, (value: string) => { failedSrc = value; }] } : require(name) });
  const render = exports.default!;
  const image = render({ src: "broken.png", alt: "토큰 · 12345678 미리보기" });
  assert.equal(image.type, "img");
  (image.props.onError as () => void)();
  const fallback = render({ src: "broken.png", alt: "토큰 · 12345678 미리보기" });
  assert.equal(fallback.type, "span");
  assert.equal(fallback.props.role, "img");
  assert.match(String(fallback.props["aria-label"]), /토큰 · 12345678/);
  assert.equal(render({ src: "new.png", alt: "새 미리보기" }).type, "img");
  assert.equal(render({ alt: "URL 발급 실패" }).type, "span");
});
