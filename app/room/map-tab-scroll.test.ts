import assert from "node:assert/strict";
import test from "node:test";

import { revealMapTab } from "./map-tab-scroll.ts";

function setup(scrollLeft = 0, clientWidth = 300) {
  let writes = 0;
  const list = {
    clientWidth, scrollTop: 50,
    get scrollLeft() { return scrollLeft; },
    set scrollLeft(value: number) { scrollLeft = value; writes++; },
  };
  const tab = (offsetLeft: number, offsetWidth = 130) => ({ parentElement: list, offsetLeft, offsetWidth }) as unknown as HTMLButtonElement;
  return { list, tab, writes: () => writes };
}

test("오른쪽에 가려진 탭은 필요한 거리만큼만 이동한다", () => {
  const h = setup();
  revealMapTab(h.tab(524));
  assert.equal(h.list.scrollLeft, 354);
  assert.equal(h.list.scrollTop, 50);
});

test("왼쪽에 가려진 탭은 시작 위치까지 이동한다", () => {
  const h = setup(500);
  revealMapTab(h.tab(131));
  assert.equal(h.list.scrollLeft, 131);
});

test("이미 보이는 탭과 경계에 맞는 탭은 스크롤을 쓰지 않는다", () => {
  const h = setup(131);
  revealMapTab(h.tab(131));
  revealMapTab(h.tab(301));
  assert.equal(h.list.scrollLeft, 131);
  assert.equal(h.writes(), 0);
});

test("목록보다 넓은 탭은 시작 부분을 보이며 반복 호출에도 유지한다", () => {
  const h = setup(0, 100);
  revealMapTab(h.tab(131));
  revealMapTab(h.tab(131));
  assert.equal(h.list.scrollLeft, 131);
});

test("탭·부모가 없거나 숨겨진 목록이면 이동하지 않는다", () => {
  const h = setup(100, 0);
  revealMapTab(null);
  revealMapTab({ parentElement: null } as HTMLButtonElement);
  revealMapTab(h.tab(524));
  assert.equal(h.list.scrollLeft, 100);
  assert.equal(h.writes(), 0);
});
