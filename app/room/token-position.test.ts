import assert from "node:assert/strict";
import test from "node:test";

import { gridCoordinate, mapPointFromClient } from "./token-position.ts";

test("contain으로 축소된 맵의 포인터를 그리드 좌표로 변환한다", () => {
  const point = mapPointFromClient(250, 400, { left: 0, top: 0, width: 1000, height: 800 }, { width: 1000, height: 500 });

  assert.deepEqual(point, { x: 250, y: 250 });
  assert.equal(gridCoordinate(point!.x, 50, 50), 4);
  assert.equal(gridCoordinate(point!.y, 0, 50), 5);
});
