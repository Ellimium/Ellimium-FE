import assert from "node:assert/strict";
import test from "node:test";

import { hideArea, rectangleFromPoints } from "./map-visibility.ts";

test("드래그 영역을 맵 안의 직사각형으로 제한한다", () => {
  assert.deepEqual(
    rectangleFromPoints({ x: 80, y: 70 }, { x: -10, y: 20 }, { width: 100, height: 100 }),
    { x: 0, y: 20, width: 80, height: 50 },
  );
  assert.equal(rectangleFromPoints({ x: 5, y: 5 }, { x: 5.5, y: 8 }, { width: 100, height: 100 }), null);
});

test("공개 영역 가운데를 가리면 네 직사각형으로 나눈다", () => {
  assert.deepEqual(hideArea(
    [{ x: 0, y: 0, width: 100, height: 100 }],
    { x: 20, y: 30, width: 40, height: 50 },
  ), [
    { x: 0, y: 0, width: 100, height: 30 },
    { x: 0, y: 80, width: 100, height: 20 },
    { x: 0, y: 30, width: 20, height: 50 },
    { x: 60, y: 30, width: 40, height: 50 },
  ]);
});
