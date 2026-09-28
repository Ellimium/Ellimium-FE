import assert from "node:assert/strict";
import test from "node:test";

import { visibleDiceRolls } from "./dice-log.ts";
import type { DiceRollLog } from "./dice-log.ts";

const rolls: DiceRollLog[] = [
  { id: "1", roller_id: "alice", expression: "1d20", individual_results: [12], total: 12, created_at: "2026-09-28T01:00:00Z" },
  { id: "2", roller_id: "bob", expression: "2d6", individual_results: [3, 4], total: 7, created_at: "2026-09-28T02:00:00Z" },
  { id: "3", roller_id: "alice", expression: "1d8+2", individual_results: [6], total: 8, created_at: "2026-09-28T03:00:00Z" },
];

test("주사위 로그를 시간순 정렬하고 사용자 필터와 검색을 적용한다", () => {
  const names = { alice: "앨리스", bob: "Bob" };

  assert.deepEqual(visibleDiceRolls(rolls, names, "", "", "desc").map((roll) => roll.id), ["3", "2", "1"]);
  assert.deepEqual(visibleDiceRolls(rolls, names, "alice", "", "asc").map((roll) => roll.id), ["1", "3"]);
  assert.deepEqual(visibleDiceRolls(rolls, names, "", "bob", "desc").map((roll) => roll.id), ["2"]);
  assert.deepEqual(visibleDiceRolls(rolls, names, "", "3 + 4", "desc").map((roll) => roll.id), ["2"]);
});
