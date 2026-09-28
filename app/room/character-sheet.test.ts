import assert from "node:assert/strict";
import test from "node:test";

import { buildAttributes } from "./character-sheet.ts";

test("D&D 5e와 CoC 7판 기본 능력치를 숫자로 만든다", () => {
  assert.deepEqual(buildAttributes("dnd_5e", { STR: "16", DEX: "14", CON: "13", INT: "12", WIS: "10", CHA: "8" }), {
    STR: 16, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8,
  });
  assert.equal(Object.keys(buildAttributes("coc_7e", { STR: "50", CON: "55", SIZ: "60", DEX: "65", APP: "45", INT: "70", POW: "75", EDU: "80" })).length, 8);
});

test("사용자 정의 항목의 숫자와 문자열을 보존한다", () => {
  assert.deepEqual(buildAttributes("custom", {}, "행운=50\n직업=탐정"), { 행운: 50, 직업: "탐정" });
  assert.throws(() => buildAttributes("custom", {}, "행운=50\n행운=60"), /중복/);
  assert.throws(() => buildAttributes("custom", {}, "잘못된 항목"), /이름=값/);
});

test("필수 기본 능력치 누락을 거부한다", () => {
  assert.throws(() => buildAttributes("dnd_5e", { STR: "16" }), /모든 기본 능력치/);
});
