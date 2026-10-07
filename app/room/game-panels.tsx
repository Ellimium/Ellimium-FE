"use client";

import { Fragment, useState, type ReactNode } from "react";
import { defaultPanelSettings, movePanel } from "./gm-screen-settings";
import { useRoomPermissions } from "./room-permissions";

type Panel = { id: string; title: string; content: ReactNode };

function MasterPanels({ panels }: { panels: Panel[] }) {
  const [settings, setSettings] = useState(() => defaultPanelSettings(panels.map((panel) => panel.id)));
  function toggle(panelId: string, field: "collapsed" | "visible") {
    setSettings((current) => current.map((setting) =>
      setting.panel_id === panelId ? { ...setting, [field]: !setting[field] } : setting));
  }

  return <aside className="game-panel gm-game-panel" aria-label="게임 패널">
    <details className="gm-panel-settings">
      <summary>GM 화면 설정</summary>
      <p>이번 접속에서만 적용됩니다.</p>
      <ol>
        {settings.map((setting, index) => {
          const panel = panels.find((item) => item.id === setting.panel_id)!;
          return <li key={panel.id}>
            <label><input type="checkbox" checked={setting.visible} onChange={() => toggle(panel.id, "visible")} />{panel.title}</label>
            <button type="button" aria-label={`${panel.title} 위로 이동`} disabled={index === 0}
              onClick={() => setSettings((current) => movePanel(current, panel.id, -1))}>↑</button>
            <button type="button" aria-label={`${panel.title} 아래로 이동`} disabled={index === settings.length - 1}
              onClick={() => setSettings((current) => movePanel(current, panel.id, 1))}>↓</button>
          </li>;
        })}
      </ol>
      <button type="button" onClick={() => setSettings(defaultPanelSettings(panels.map((panel) => panel.id)))}>기본 화면으로 되돌리기</button>
    </details>
    {settings.map((setting) => {
      const panel = panels.find((item) => item.id === setting.panel_id)!;
      const contentId = `gm-panel-${panel.id}`;
      return <section key={panel.id} className="gm-panel" hidden={!setting.visible} aria-label={`${panel.title} 패널`}>
        <div className="gm-panel-heading">
          <span>{panel.title}</span>
          <button type="button" aria-label={`${panel.title} ${setting.collapsed ? "펼치기" : "접기"}`}
            aria-expanded={!setting.collapsed} aria-controls={contentId}
            onClick={() => toggle(panel.id, "collapsed")}>{setting.collapsed ? "펼치기" : "접기"}</button>
        </div>
        <div id={contentId} hidden={setting.collapsed}>{panel.content}</div>
      </section>;
    })}
  </aside>;
}

export default function GamePanels({ panels, roomId }: { panels: Panel[]; roomId?: string }) {
  const { role, currentUserId, loading } = useRoomPermissions();
  if (!loading && role === "master" && currentUserId) {
    return <MasterPanels key={`${roomId}:${currentUserId}`} panels={panels} />;
  }
  return <aside className="game-panel" aria-label="게임 패널">
    {panels.map((panel) => <Fragment key={panel.id}>{panel.content}</Fragment>)}
  </aside>;
}
