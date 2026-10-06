import assert from "node:assert/strict";
import test from "node:test";

import { buildAttributes, canEditCharacterSheet, formatSheetEntries, parseSheetEntries, sheetRollItems, sheetRollMessage } from "./character-sheet.ts";

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

test("편집 항목을 줄 단위로 변환하고 검증한다", () => {
  assert.deepEqual(parseSheetEntries("운동=5\n직업=탐정"), { 운동: 5, 직업: "탐정" });
  assert.equal(formatSheetEntries({ HP: 12, 상태: "정상" }), "HP=12\n상태=정상");
  assert.throws(() => parseSheetEntries("행운=50\n행운=60"), /중복/);
});

test("마스터와 시트 소유자만 편집할 수 있다", () => {
  assert.equal(canEditCharacterSheet("master", "master", "player"), true);
  assert.equal(canEditCharacterSheet("player", "player", "player"), true);
  assert.equal(canEditCharacterSheet("player", "peer", "player"), false);
  assert.equal(canEditCharacterSheet("spectator", "spectator", "player"), false);
});

test("지원하는 시스템의 정수 항목만 시트 굴림을 제공한다", () => {
  assert.deepEqual(sheetRollItems("dnd_5e", "attribute", { STR: 16, DEX: 9, HP: 12, CON: "13", INT: 0, WIS: 1.5 }), [["STR", 16], ["DEX", 9]]);
  assert.deepEqual(sheetRollItems("coc_7e", "skill", { 관찰력: 60, 미숙: 0, 문자: "50", 음수: -1 }), [["관찰력", 60], ["미숙", 0]]);
  assert.deepEqual(sheetRollItems("custom", "attribute", { STR: 16 }), []);
  assert.deepEqual(sheetRollItems("dnd_5e", "skill", { 운동: 5 }), []);
});

test("D&D는 서버가 적용한 양수·음수 수정치와 합계를 표시한다", () => {
  for (const [expression, total] of [["1d20+3", 18], ["1d20-1", 9]] as const) {
    assert.equal(sheetRollMessage({ id: "roll", expression, total, sheet_roll: { system: "dnd_5e", character_name: "전사", item_key: "STR", value: 16 } }), `전사 · STR: ${expression} → ${total}`);
  }
});

test("CoC는 굴림 당시 스킬 값으로 경계값·성공·실패를 비교한다", () => {
  for (const total of [55, 60, 61]) {
    const result = sheetRollMessage({ id: "roll", expression: "1d100", total, sheet_roll: { system: "coc_7e", character_name: "탐사자", item_key: "관찰력", value: 60 } });
    assert.equal(result, `탐사자 · 관찰력: 1d100 → ${total} / 60 · ${total <= 60 ? "성공" : "실패"}`);
  }
});
