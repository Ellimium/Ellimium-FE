import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("맵 등록 성공 후 같은 화면의 룸 맵을 다시 조회한다", () => {
  const registration = readFileSync(new URL("map-registration.tsx", import.meta.url), "utf8");
  const roomMap = readFileSync(new URL("room-map.tsx", import.meta.url), "utf8");

  assert.match(registration, /if \(insertError\) \{[\s\S]*?return;[\s\S]*?\}\s*window\.dispatchEvent\(new CustomEvent\("room-map-registered", \{ detail: roomId \}\)\);/);
  assert.match(roomMap, /window\.addEventListener\("room-map-registered", refresh\);[\s\S]*?void load\(\)/);
  assert.match(roomMap, /detail === roomId\) void load\(\)/);
  assert.match(roomMap, /window\.removeEventListener\("room-map-registered", refresh\)/);
});
