"use client";

import { useState } from "react";

export default function RoomQuickNavigation() {
  const [notice, setNotice] = useState("");

  function moveTo(ids: string[], title: string) {
    const panels = ids.map((id) => document.getElementById(id)).filter((panel) => panel !== null);
    const visible = panels.find((panel) => !panel.closest("[hidden]"));
    const collapsed = panels.map((panel) => panel.closest<HTMLElement>(".gm-panel"))
      .find((panel) => panel && !panel.hidden);
    const target = visible ?? collapsed;
    if (target) {
      setNotice(collapsed === target ? `${title} 패널이 접혀 있습니다. 펼치기 버튼으로 열 수 있습니다.` : "");
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start" });
      return;
    }
    const settings = document.querySelector<HTMLDetailsElement>(".gm-panel-settings");
    if (settings) {
      settings.open = true;
      const summary = settings.querySelector("summary")!;
      setNotice(`${title} 패널이 숨겨져 있습니다. GM 화면 설정에서 다시 표시할 수 있습니다.`);
      summary.focus({ preventScroll: true });
      settings.scrollIntoView({ block: "start" });
    } else {
      setNotice("패널을 불러온 뒤 다시 시도하세요.");
    }
  }

  return <nav className="room-quick-navigation" aria-label="룸 패널 바로가기">
    <button type="button" onClick={() => moveTo(["room-map"], "맵")}>맵</button>
    <button type="button" onClick={() => moveTo(["room-chat", "room-dice"], "대화")}>대화</button>
    <button type="button" onClick={() => moveTo(["room-character-sheets"], "시트")}>시트</button>
    <p role="status">{notice}</p>
  </nav>;
}
