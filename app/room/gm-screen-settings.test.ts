import assert from "node:assert/strict";
import test from "node:test";
import { defaultPanelSettings, movePanel, restorePanelSettings } from "./gm-screen-settings.ts";

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
