import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import type { ReactElement } from "react";
import ts from "typescript";

function setup() {
  const require = createRequire(import.meta.url);
  const states: unknown[] = [{ name: "검증 룸", game_system: "custom", invite_code: "test-code" }, "", true, ""];
  let cursor = 0;
  type BlurEvent = { currentTarget: { contains(target: object | null): boolean }; relatedTarget: object | null };
  const module = { exports: {} as { default: (props: { roomId?: string }) => ReactElement<{ children: ReactElement<{ onBlur(event: BlurEvent): void }>[] }> } };
  const source = readFileSync(new URL("header.tsx", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, {
    module, exports: module.exports,
    window: { location: { origin: "http://127.0.0.1:3000" } },
    require: (id: string) => {
      if (id === "react") return {
        useEffect: () => {},
        useState: () => {
          const index = cursor++;
          return [states[index], (value: unknown) => { states[index] = value; }];
        },
      };
      if (id === "next/link") return { default: "a" };
      if (id === "@/lib/supabase/client") return {};
      if (id === "./room-connection") return { useRoomConnection: () => ({ state: "ready" }) };
      if (id === "./record-connection") return { RECORD_CONNECTION_LABELS: { ready: "연결됨" } };
      return require(id);
    },
  });
  const actions = module.exports.default({}).props.children[1];
  const inside = {};
  return {
    inside,
    blur(target: object | null) {
      actions.props.onBlur({ currentTarget: { contains: (node) => node === inside }, relatedTarget: target });
    },
    isOpen: () => states[2],
  };
}

test("비포커스 텍스트 선택으로 relatedTarget이 null이어도 초대 창을 유지한다", () => {
  const h = setup();
  h.blur(null);
  assert.equal(h.isOpen(), true);
});

test("초대 영역 내부로 포커스가 이동하면 창을 유지한다", () => {
  const h = setup();
  h.blur(h.inside);
  assert.equal(h.isOpen(), true);
});

test("초대 영역 밖의 요소로 포커스가 이동하면 창을 닫는다", () => {
  const h = setup();
  h.blur({});
  assert.equal(h.isOpen(), false);
});
