import type { RoomMembershipView } from "./room-membership.ts";

export const ROOM_ACCESS_ENDED_MESSAGE = "룸 참가가 종료되어 로비로 이동했습니다.";
export const ROOM_ACCESS_ENDED_URL = "/?roomAccess=ended";

export function isRoomAccessEnded(view: RoomMembershipView) {
  return !view.checking && !view.error && Boolean(view.userId) && view.role === null;
}
