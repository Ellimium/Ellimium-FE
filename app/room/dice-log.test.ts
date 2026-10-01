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
