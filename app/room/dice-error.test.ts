import assert from "node:assert/strict";
import test from "node:test";

import { diceErrorMessage } from "./dice-error.ts";

test("주사위 RPC 오류를 입력·범위·권한 오류로 구분한다", () => {
  assert.match(diceErrorMessage({ message: "invalid dice expression" }), /표현식/);
  assert.match(diceErrorMessage({ message: "dice count must be between 1 and 100" }), /100개/);
  assert.match(diceErrorMessage({ message: "dice sides must be between 1 and 4294967296" }), /숫자 범위/);
  assert.match(diceErrorMessage({ code: "42501", message: "dice roll permission required" }), /권한/);
  assert.match(diceErrorMessage({ message: "unexpected failure" }), /처리하지 못했습니다/);
});
