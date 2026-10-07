import assert from "node:assert/strict";
import test from "node:test";
import { isRoomAccessEnded, ROOM_ACCESS_ENDED_URL } from "./room-access.ts";
import type { RoomMembershipView } from "./room-membership.ts";

const snapshot: RoomMembershipView = { userId: "me", role: "player", members: [], rows: [], checking: false, error: "" };

test("로그인한 사용자의 멤버십 부재가 확인된 경우에만 룸을 종료한다", () => {
  assert.equal(isRoomAccessEnded({ ...snapshot, role: null }), true);
  for (const view of [snapshot, { ...snapshot, role: null, checking: true },
    { ...snapshot, role: null, error: "조회 실패" }, { ...snapshot, role: null, userId: null }]) {
    assert.equal(isRoomAccessEnded(view), false);
  }
  assert.equal(ROOM_ACCESS_ENDED_URL, "/?roomAccess=ended");
});
