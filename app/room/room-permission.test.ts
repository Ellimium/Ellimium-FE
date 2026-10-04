import assert from "node:assert/strict";
import test from "node:test";

import { mergeRoomFeaturePermission, resolveRoomFeatureState } from "./room-permission.ts";
import type { RoomFeaturePermission } from "./room-permission.ts";

const roomId = "room";
const playerId = "player";
const rows: RoomFeaturePermission[] = [
  { id: "player-chat", room_id: roomId, feature: "chat", role: "player", user_id: null, allowed: true },
  { id: "player-map", room_id: roomId, feature: "map_view", role: "player", user_id: null, allowed: true },
  { id: "player-dice", room_id: roomId, feature: "dice", role: "player", user_id: null, allowed: false },
  { id: "player-token", room_id: roomId, feature: "token_move", role: "player", user_id: null, allowed: false },
  { id: "player-drawing", room_id: roomId, feature: "drawing", role: "player", user_id: null, allowed: false },
];

test("마스터는 저장된 설정과 관계없이 모든 기능을 사용할 수 있다", () => {
  assert.deepEqual(resolveRoomFeatureState("master", "master", rows), {
    chat: true,
    map_view: true,
    dice: true,
    token_move: true,
    drawing: true,
  });
});

test("역할별 기능 권한을 참가자 화면 상태로 변환한다", () => {
  assert.deepEqual(resolveRoomFeatureState("player", playerId, rows), {
    chat: true,
    map_view: true,
    dice: false,
    token_move: false,
    drawing: false,
  });
});

test("참가자별 권한이 역할 기본값보다 우선한다", () => {
  const override: RoomFeaturePermission = {
    id: "player-dice-override",
    room_id: roomId,
    feature: "dice",
    role: null,
    user_id: playerId,
    allowed: true,
  };

  assert.equal(resolveRoomFeatureState("player", playerId, [...rows, override]).dice, true);
});

test("권한 실시간 변경은 같은 행을 교체하고 새 행을 추가한다", () => {
  const changed = { ...rows[0], allowed: false };
  const added = { ...rows[0], id: "spectator-chat", role: "spectator" as const };

  assert.equal(mergeRoomFeaturePermission(rows, changed)[0].allowed, false);
  assert.equal(mergeRoomFeaturePermission(rows, added).length, rows.length + 1);
});

test("멤버십이나 설정이 없으면 모든 기능을 거부한다", () => {
  assert.deepEqual(resolveRoomFeatureState(null, null, []), {
    chat: false,
    map_view: false,
    dice: false,
    token_move: false,
    drawing: false,
  });
});
