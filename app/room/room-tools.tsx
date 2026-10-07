"use client";

import { useRoomPermissions } from "./room-permissions";

export default function RoomTools() {
  const { role, loading, checking, error, canUse } = useRoomPermissions();
  const canViewMap = canUse("map_view");
  const canMoveTokens = canViewMap && canUse("token_move") && (role === "master" || role === "player");
  const canDraw = canViewMap && canUse("drawing") && (role === "master" || role === "player");

  return <aside className="tool-rail" aria-label="맵 도구" aria-busy={loading}>
    <button className={canViewMap ? "tool-active" : ""} type="button" aria-label="선택" disabled={!canViewMap}>↖</button>
    <button type="button" aria-label="이동" disabled={!canMoveTokens}>✥</button>
    <button type="button" aria-label="그리기" disabled={!canDraw}>✎</button>
    <button type="button" aria-label="거리 측정" disabled={!canViewMap}>⌁</button>
    <button type="button" aria-label="시야 설정" disabled={loading || checking || Boolean(error) || role !== "master"}>◐</button>
    <span />
    <button type="button" aria-label="설정" disabled={loading || checking || Boolean(error) || role !== "master"}>⚙</button>
  </aside>;
}
