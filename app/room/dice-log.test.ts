import assert from "node:assert/strict";
import test from "node:test";

import { diceRollDisplay, mergeDiceRolls, visibleDiceRolls } from "./dice-log.ts";
import type { DiceRollLog } from "./dice-log.ts";

const rolls: DiceRollLog[] = [
  { id: "1", room_id: "room", roller_id: "alice", visibility: "public", expression: "1d20", individual_results: [12], total: 12, created_at: "2026-09-28T01:00:00Z" },
  { id: "2", room_id: "room", roller_id: "bob", visibility: "private", created_at: "2026-09-28T02:00:00Z" },
  { id: "3", room_id: "room", roller_id: "alice", visibility: "private", expression: "1d8+2", individual_results: [6], total: 8, created_at: "2026-09-28T03:00:00Z" },
];

test("주사위 로그를 시간순 정렬하고 사용자·공개 상태·검색 필터를 적용한다", () => {
  const names = { alice: "앨리스", bob: "Bob" };

  assert.deepEqual(visibleDiceRolls(rolls, names, "", "", "", "desc").map((roll) => roll.id), ["3", "2", "1"]);
  assert.deepEqual(visibleDiceRolls(rolls, names, "alice", "", "", "asc").map((roll) => roll.id), ["1", "3"]);
  assert.deepEqual(visibleDiceRolls(rolls, names, "", "private", "", "desc").map((roll) => roll.id), ["3", "2"]);
  assert.deepEqual(visibleDiceRolls(rolls, names, "", "", "bob", "desc").map((roll) => roll.id), ["2"]);
  assert.deepEqual(visibleDiceRolls(rolls, names, "", "", "6", "desc").map((roll) => roll.id), ["3"]);
});

test("값 없는 알림과 상세 결과를 같은 굴림으로 병합한다", () => {
  const notification = rolls[1];
  const detail: DiceRollLog = { ...notification, expression: "2d6", individual_results: [3, 4], total: 7 };

  assert.deepEqual(mergeDiceRolls(mergeDiceRolls([], notification), detail), [detail]);
  assert.deepEqual(mergeDiceRolls(mergeDiceRolls([], detail), notification), [detail]);
  assert.deepEqual(diceRollDisplay(detail), { total: "7", summary: "2d6 · 비공개", results: "3 + 4" });
  assert.deepEqual(diceRollDisplay(notification), { total: "?", summary: "비공개 굴림 · 비공개", results: "결과는 마스터와 굴린 사용자에게만 공개됩니다." });
});

const sheetRoll: DiceRollLog = {
  ...rolls[0], character_sheet_id: "character", expression: "1d20+3", total: 15,
  sheet_roll: { system: "dnd_5e", character_name: "전사", item_key: "STR", value: 16, modifier: 3 },
};

test("시트 로그의 캐릭터·항목과 굴림 당시 수정치를 표시하고 검색한다", () => {
  assert.deepEqual(diceRollDisplay(sheetRoll), { total: "15", summary: "전사 · STR (수정치 +3) · 1d20+3 · 공개", results: "12" });
  for (const query of ["전사", "str"]) {
    assert.deepEqual(visibleDiceRolls([sheetRoll], {}, "", "", query, "desc"), [sheetRoll]);
  }
  const negative = { ...sheetRoll, expression: "1d20-1", sheet_roll: { ...sheetRoll.sheet_roll!, modifier: -1 } };
  assert.match(diceRollDisplay(negative).summary, /수정치 -1/);
});

test("CoC 로그는 보존된 스킬 값과 결과를 비교하며 경계값을 성공으로 표시한다", () => {
  for (const total of [55, 60, 61]) {
    const roll: DiceRollLog = { ...sheetRoll, expression: "1d100", total, sheet_roll: { system: "coc_7e", character_name: "탐사자", item_key: "관찰력", value: 60, modifier: null } };
    assert.equal(diceRollDisplay(roll).summary, `탐사자 · 관찰력 (기준 60 · ${total <= 60 ? "성공" : "실패"}) · 1d100 · 공개`);
  }
});

test("초기 조회·실시간 병합·재조회가 같은 시트 로그를 유지한다", () => {
  const notification: DiceRollLog = { id: sheetRoll.id, room_id: sheetRoll.room_id, roller_id: sheetRoll.roller_id, visibility: sheetRoll.visibility, created_at: sheetRoll.created_at };
  for (const merged of [mergeDiceRolls([notification], sheetRoll), mergeDiceRolls([sheetRoll], notification), mergeDiceRolls([sheetRoll], [notification, sheetRoll])]) {
    assert.deepEqual(merged, [sheetRoll]);
    assert.deepEqual(diceRollDisplay(merged[0]), diceRollDisplay(sheetRoll));
  }
  // Deleting the sheet clears the reference but retains its roll-time snapshot.
  assert.deepEqual(diceRollDisplay({ ...sheetRoll, character_sheet_id: null }), diceRollDisplay(sheetRoll));
});

test("값 없는 비공개 알림은 시트 정보가 있더라도 표시·검색하지 않는다", () => {
  const notification: DiceRollLog = { ...sheetRoll, visibility: "private", expression: undefined, total: undefined, individual_results: undefined };
  assert.deepEqual(diceRollDisplay(notification), { total: "?", summary: "비공개 굴림 · 비공개", results: "결과는 마스터와 굴린 사용자에게만 공개됩니다." });
  assert.deepEqual(visibleDiceRolls([notification], {}, "", "", "전사", "desc"), []);
  const authorized = { ...sheetRoll, visibility: "private" as const };
  assert.match(diceRollDisplay(authorized).summary, /전사.*비공개/);
});


test("동일 시각 ID와 PostgreSQL 마이크로초를 커서 조회와 같은 순서로 정렬한다", () => {
  const rows = [
    { ...rolls[0], id: "a", created_at: "2026-10-08T00:00:00.000999+00:00" },
    { ...rolls[0], id: "z", created_at: "2026-10-08T00:00:00.000001+00:00" },
    { ...rolls[0], id: "b", created_at: "2026-10-08T00:00:00.000999+00:00" },
  ];
  assert.deepEqual(visibleDiceRolls(rows, {}, "", "", "", "asc").map((r) => r.id), ["z", "a", "b"]);
  assert.deepEqual(visibleDiceRolls(rows, {}, "", "", "", "desc").map((r) => r.id), ["b", "a", "z"]);
});
