import assert from "node:assert/strict";
import test from "node:test";

import { createDrawingDraft, drawingPointFromClient } from "./map-drawing.ts";

const style = { color: "#123ABC", strokeWidth: 4 };

test("선·원·사각형을 공통 그리기 데이터로 만든다", () => {
  assert.deepEqual(createDrawingDraft("line", [{ x: 1, y: 2 }, { x: 5, y: 6 }], style), {
    drawing_type: "line",
    geometry: { start: { x: 1, y: 2 }, end: { x: 5, y: 6 } },
    text_content: null,
    color: "#123ABC",
    stroke_width: 4,
  });
  assert.deepEqual(createDrawingDraft("circle", [{ x: 1, y: 2 }, { x: 4, y: 6 }], style), {
    drawing_type: "circle",
    geometry: { center: { x: 1, y: 2 }, radius: 5 },
    text_content: null,
    color: "#123ABC",
    stroke_width: 4,
  });
  assert.deepEqual(createDrawingDraft("rectangle", [{ x: 8, y: 9 }, { x: 2, y: 3 }], style), {
    drawing_type: "rectangle",
    geometry: { x: 2, y: 3, width: 6, height: 6 },
    text_content: null,
    color: "#123ABC",
    stroke_width: 4,
  });
});

test("자유 곡선은 브러쉬 경로 전체를 보존한다", () => {
  const points = [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 5, y: 8 }];
  assert.deepEqual(createDrawingDraft("freehand", points, style), {
    drawing_type: "freehand",
    geometry: { points },
    text_content: null,
    color: "#123ABC",
    stroke_width: 4,
  });
});

test("텍스트의 위치와 공백을 정리한 내용을 저장한다", () => {
  assert.deepEqual(createDrawingDraft("text", [{ x: 10, y: 20 }], style, "  비밀 문  "), {
    drawing_type: "text",
    geometry: { x: 10, y: 20 },
    text_content: "비밀 문",
    color: "#123ABC",
    stroke_width: 4,
  });
});

test("불완전한 도형과 BE 제약에 맞지 않는 스타일을 거부한다", () => {
  assert.equal(createDrawingDraft("line", [{ x: 1, y: 1 }, { x: 1, y: 1 }], style), null);
  assert.equal(createDrawingDraft("circle", [{ x: 1, y: 1 }, { x: 1.5, y: 1 }], style), null);
  assert.equal(createDrawingDraft("rectangle", [{ x: 1, y: 1 }, { x: 1.5, y: 4 }], style), null);
  assert.equal(createDrawingDraft("freehand", [{ x: 1, y: 1 }], style), null);
  assert.equal(createDrawingDraft("text", [{ x: 1, y: 1 }], style, "  "), null);
  assert.equal(createDrawingDraft("line", [{ x: 1, y: 1 }, { x: 2, y: 2 }], { color: "red", strokeWidth: 4 }), null);
  assert.equal(createDrawingDraft("line", [{ x: 1, y: 1 }, { x: 2, y: 2 }], { color: "#123ABC", strokeWidth: 0 }), null);
});

test("화면 배율과 contain 여백을 반영해 포인터를 맵 좌표로 바꾼다", () => {
  assert.deepEqual(
    drawingPointFromClient(250, 400, { left: 0, top: 0, width: 1000, height: 800 }, { width: 1000, height: 500 }),
    { x: 250, y: 250 },
  );
  assert.deepEqual(
    drawingPointFromClient(250, 125, { left: 0, top: 0, width: 500, height: 250 }, { width: 1000, height: 500 }),
    { x: 500, y: 250 },
  );
});

test("맵 이미지 밖의 포인터와 유효하지 않은 크기는 거부한다", () => {
  assert.equal(
    drawingPointFromClient(250, 100, { left: 0, top: 0, width: 1000, height: 800 }, { width: 1000, height: 500 }),
    null,
  );
  assert.equal(
    drawingPointFromClient(10, 10, { left: 0, top: 0, width: 0, height: 0 }, { width: 1000, height: 500 }),
    null,
  );
});
