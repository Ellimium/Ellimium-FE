import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { RecordConnectionState } from "./record-connection.ts";

const require = createRequire(import.meta.url);
function compile(file: string) {
  return ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

test("헤더는 실제 상태를 읽고 실패·단절 때만 재시도 버튼을 표시한다", () => {
  for (const state of ["connecting", "syncing", "ready", "disconnected", "error"] as const) {
    const exports: { default?: React.FunctionComponent } = {};
    runInNewContext(compile("header.tsx"), {
      exports,
      require: (name: string) => {
        if (name === "react") return { ...React, useEffect: () => {} };
        if (name === "next/link") return { __esModule: true, default: (props: object) => React.createElement("a", props) };
        if (name === "./room-connection") return { useRoomConnection: () => ({ state, retry: () => {} }) };
        if (name === "@/lib/supabase/client") return { supabase: {} };
        return require(name.startsWith("./") ? `${name}.ts` : name);
      },
    });
    const html = renderToStaticMarkup(React.createElement(exports.default!));
    assert.match(html, new RegExp(`role="status" class="live-dot record-status-${state}"`));
    assert.equal(html.includes("다시 시도"), state === "error" || state === "disconnected");
    assert.equal(html.includes(">연결됨<"), state === "ready");
  }
});

test("헤더 재시도는 실패·단절된 기능만 복구한다", () => {
  for (const chat of ["ready", "error", "disconnected", "syncing"] as const) {
    let chatRetries = 0; let diceRetries = 0;
    const exports: { useRoomConnection?: () => { state: RecordConnectionState; retry: () => void } } = {};
    runInNewContext(compile("room-connection.tsx"), {
      exports,
      require: (name: string) => {
        if (name === "react") return { ...React, useContext: () => ({ records: {
          chat: { state: chat, retry: () => { chatRetries++; } },
          dice: { state: "error", retry: () => { diceRetries++; } },
        } }) };
        return require(name.startsWith("./") ? `${name}.ts` : name);
      },
    });
    const connection = exports.useRoomConnection!(); connection.retry();
    assert.equal(chatRetries, chat === "error" || chat === "disconnected" ? 1 : 0);
    assert.equal(diceRetries, 1);
    assert.equal(connection.state, chat === "disconnected" ? "disconnected" : "error");
  }
});
