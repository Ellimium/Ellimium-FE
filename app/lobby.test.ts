import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("lobby renders RLS-filtered rooms with identified links and explicit states", () => {
  const source = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

  assert.match(source, /from\("rooms"\)/);
  assert.match(source, /href={`\/room\?roomId=\$\{room\.id\}`}>/);
  assert.doesNotMatch(source, /href="\/room"/);
  assert.match(source, /캠페인을 불러오는 중/);
  assert.match(source, /캠페인 목록을 불러오지 못했습니다/);
  assert.match(source, /참여 중인 캠페인이 없습니다/);
});
