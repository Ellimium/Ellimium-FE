import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const roomMap = readFileSync(new URL("room-map.tsx", import.meta.url), "utf8");

test("다섯 가지 도구와 색상·선 두께 선택 UI를 제공한다", () => {
  for (const [type, label] of [["line", "선"], ["circle", "원"], ["rectangle", "사각형"], ["freehand", "브러시"], ["text", "텍스트"]]) {
    assert.match(roomMap, new RegExp(`${type}: "${label}"`));
  }
  assert.match(roomMap, /type="color"/);
  assert.match(roomMap, /aria-label="선 두께"/);
});

test("그리기 UI는 권한과 재확인 중인 기존 드래그를 기준으로 표시한다", () => {
  assert.match(roomMap, /selected && \(canDraw \|\| \(checking && drawingDrag\)\) && <details className="drawing-controls"/);
  assert.match(roomMap, /drawingEditing && \(canDraw \|\| \(checking && drawingDrag\)\) && !fogEditing && <rect/);
});

test("그림 CRUD와 private Broadcast 세 이벤트를 연결한다", () => {
  assert.match(roomMap, /from\("room_map_drawings"\)[\s\S]*?\.insert\(/);
  assert.match(roomMap, /from\("room_map_drawings"\)[\s\S]*?\.update\(/);
  assert.match(roomMap, /from\("room_map_drawings"\)\.delete\(\)/);
  assert.match(roomMap, /channel\(`room:\$\{roomId\}:drawings`, \{ config: \{ private: true \} \}\)/);
  assert.match(roomMap, /\["INSERT", "UPDATE", "DELETE"\]/);
});
