import assert from "node:assert/strict";
import test from "node:test";
import { defaultPanelSettings, movePanel, restorePanelSettings } from "./gm-screen-settings.ts";

const roomPanelIds = ["chat", "dice", "character-sheets", "map-registration", "participants", "feature-permissions", "jukebox"];

test("저장 설정이 없으면 플레이 패널은 펼치고 준비·관리 패널은 접는다", () => {
  const settings = restorePanelSettings(roomPanelIds, []);
  assert.deepEqual(settings, defaultPanelSettings(roomPanelIds));
  assert.deepEqual(settings.map(({ panel_id, collapsed, visible, position }) =>
    [panel_id, collapsed, visible, position]), [
    ["chat", false, true, 0],
    ["dice", false, true, 1],
    ["character-sheets", false, true, 2],
    ["map-registration", true, true, 3],
    ["participants", true, true, 4],
    ["feature-permissions", true, true, 5],
    ["jukebox", true, true, 6],
  ]);
});

test("새 기본값과 달라도 기존 GM의 순서·표시·접힘을 모두 보존한다", () => {
  const saved = [...roomPanelIds].reverse().map((panel_id, position) => ({
    panel_id, position, collapsed: panel_id === "chat", visible: panel_id !== "dice",
  }));
  assert.deepEqual(restorePanelSettings(roomPanelIds, saved), saved);
  assert.equal(saved.find((setting) => setting.panel_id === "jukebox")?.collapsed, false);
  assert.equal(defaultPanelSettings(roomPanelIds).find((setting) => setting.panel_id === "jukebox")?.collapsed, true);
});

test("일부 설정만 있으면 기존 설정 뒤에 누락 패널만 새 기본값으로 보충한다", () => {
  const saved = [
    { panel_id: "participants", collapsed: false, visible: false, position: 0 },
    { panel_id: "chat", collapsed: true, visible: true, position: 1 },
  ];
  const restored = restorePanelSettings(roomPanelIds, saved);
  assert.deepEqual(restored.slice(0, 2), saved);
  assert.deepEqual(restored.slice(2), [
    { panel_id: "dice", collapsed: false, visible: true, position: 2 },
    { panel_id: "character-sheets", collapsed: false, visible: true, position: 3 },
    { panel_id: "map-registration", collapsed: true, visible: true, position: 4 },
    { panel_id: "feature-permissions", collapsed: true, visible: true, position: 5 },
    { panel_id: "jukebox", collapsed: true, visible: true, position: 6 },
  ]);
  assert.deepEqual(saved.map((setting) => setting.position), [0, 1]);
});

test("패널 이동은 접힘·표시 상태를 보존하고 배치 순서를 다시 매긴다", () => {
  const settings = defaultPanelSettings(["chat", "jukebox", "dice"]);
  settings[1] = { ...settings[1], collapsed: true, visible: false };
  const moved = movePanel(settings, "jukebox", -1);
  assert.deepEqual(moved, [
    { panel_id: "jukebox", collapsed: true, visible: false, position: 0 },
    { panel_id: "chat", collapsed: false, visible: true, position: 1 },
    { panel_id: "dice", collapsed: false, visible: true, position: 2 },
  ]);
  assert.deepEqual(movePanel(moved, "jukebox", 1), settings);
  assert.deepEqual(settings.map((setting) => setting.panel_id), ["chat", "jukebox", "dice"]);
});

test("저장된 접힘·표시·배치를 복원하고 새 패널은 기본값으로 추가한다", () => {
  assert.deepEqual(restorePanelSettings(["chat", "jukebox", "dice"], [
    { panel_id: "chat", collapsed: true, visible: false, position: 4 },
    { panel_id: "jukebox", collapsed: false, visible: true, position: 1 },
  ]), [
    { panel_id: "jukebox", collapsed: false, visible: true, position: 0 },
    { panel_id: "chat", collapsed: true, visible: false, position: 1 },
    { panel_id: "dice", collapsed: false, visible: true, position: 2 },
  ]);
});

test("없는 패널과 잘못된 저장 값은 복원하지 않고 기본값을 사용한다", () => {
  assert.deepEqual(restorePanelSettings(["chat"], [null,
    { panel_id: "removed", collapsed: true, visible: false, position: 0 },
    { panel_id: "chat", collapsed: "true", visible: false, position: 0 },
    { panel_id: "chat", collapsed: true, visible: false, position: -1 },
  ]), defaultPanelSettings(["chat"]));
});

test("첫 패널·마지막 패널·없는 패널은 목록 밖으로 이동하지 않는다", () => {
  const settings = defaultPanelSettings(["chat", "dice"]);
  assert.strictEqual(movePanel(settings, "chat", -1), settings);
  assert.strictEqual(movePanel(settings, "dice", 1), settings);
  assert.strictEqual(movePanel(settings, "unknown", 1), settings);
});


test("예전 턴 순서 패널을 제외해도 나머지 저장 순서·표시·접힘 상태를 유지한다", () => {
  assert.deepEqual(restorePanelSettings(["chat", "dice", "jukebox"], [
    { panel_id: "initiative", collapsed: false, visible: true, position: 0 },
    { panel_id: "dice", collapsed: true, visible: true, position: 1 },
    { panel_id: "jukebox", collapsed: false, visible: false, position: 2 },
    { panel_id: "chat", collapsed: false, visible: true, position: 3 },
  ]), [
    { panel_id: "dice", collapsed: true, visible: true, position: 0 },
    { panel_id: "jukebox", collapsed: false, visible: false, position: 1 },
    { panel_id: "chat", collapsed: false, visible: true, position: 2 },
  ]);
});
