"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { defaultPanelSettings, movePanel, restorePanelSettings, type PanelSetting } from "./gm-screen-settings";
import { useRoomPermissions } from "./room-permissions";

type Panel = { id: string; title: string; content: ReactNode };

function MasterPanels({ panels, userId }: { panels: Panel[]; userId: string }) {
  const [settings, setSettings] = useState(() => defaultPanelSettings(panels.map((panel) => panel.id)));
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const pending = useRef(true);
  const panelIds = panels.map((panel) => panel.id).join(",");

  useEffect(() => {
    let active = true;
    async function load() {
      pending.current = true;
      setBusy(true); setLoaded(false); setError("");
      try {
        const { data, error: readError } = await supabase.from("gm_screen_settings")
          .select("panel_id, collapsed, visible, position").eq("user_id", userId);
        if (readError) throw readError;
        if (active) {
          setSettings(restorePanelSettings(panelIds.split(","), data ?? []));
          setLoaded(true);
        }
      } catch {
        if (active) setError("화면 설정을 불러오지 못했습니다. 다시 시도하세요.");
      } finally {
        if (active) { pending.current = false; setBusy(false); }
      }
    }
    void load();
    return () => { active = false; };
  }, [panelIds, revision, userId]);

  async function save(next: PanelSetting[]) {
    if (!loaded || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const { data, error: saveError } = await supabase.from("gm_screen_settings")
        .upsert(next.map((setting) => ({ ...setting, user_id: userId })), { onConflict: "user_id,panel_id" })
        .select("panel_id");
      if (saveError || data?.length !== next.length) throw saveError ?? new Error("Incomplete save");
      setSettings(next);
    } catch {
      setLoaded(false);
      setError("화면 설정 저장을 확인하지 못했습니다. 다시 불러온 후 변경하세요.");
    } finally {
      pending.current = false; setBusy(false);
    }
  }

  function toggle(panelId: string, field: "collapsed" | "visible") {
    void save(settings.map((setting) =>
      setting.panel_id === panelId ? { ...setting, [field]: !setting[field] } : setting));
  }

  const disabled = busy || !loaded;

  return <aside className="game-panel gm-game-panel" aria-label="게임 패널">
    {error && <p className="form-error gm-settings-error" role="alert">{error}</p>}
    <details className="gm-panel-settings" aria-busy={busy}>
      <summary>GM 화면 설정</summary>
      <p role="status">{busy ? loaded ? "화면 설정 저장 중…" : "화면 설정 불러오는 중…" : loaded ? "설정은 자동 저장되며 다음 접속에도 적용됩니다." : "저장된 설정을 확인한 후 변경할 수 있습니다."}</p>
      {!loaded && !busy && <button type="button" onClick={() => setRevision((value) => value + 1)}>설정 다시 불러오기</button>}
      <ol>
        {settings.map((setting, index) => {
          const panel = panels.find((item) => item.id === setting.panel_id)!;
          return <li key={panel.id}>
            <label><input type="checkbox" checked={setting.visible} disabled={disabled} onChange={() => toggle(panel.id, "visible")} />{panel.title}</label>
            <button type="button" aria-label={`${panel.title} 위로 이동`} disabled={disabled || index === 0}
              onClick={() => void save(movePanel(settings, panel.id, -1))}>↑</button>
            <button type="button" aria-label={`${panel.title} 아래로 이동`} disabled={disabled || index === settings.length - 1}
              onClick={() => void save(movePanel(settings, panel.id, 1))}>↓</button>
          </li>;
        })}
      </ol>
      <button type="button" disabled={disabled} onClick={() => void save(defaultPanelSettings(panels.map((panel) => panel.id)))}>기본 화면으로 되돌리기</button>
    </details>
    {settings.map((setting) => {
      const panel = panels.find((item) => item.id === setting.panel_id)!;
      const contentId = `gm-panel-${panel.id}`;
      return <section key={panel.id} className="gm-panel" hidden={!setting.visible} aria-label={`${panel.title} 패널`}>
        <div className="gm-panel-heading">
          <span>{panel.title}</span>
          <button type="button" disabled={disabled} aria-label={`${panel.title} ${setting.collapsed ? "펼치기" : "접기"}`}
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
    return <MasterPanels key={`${roomId}:${currentUserId}`} panels={panels} userId={currentUserId} />;
  }
  return <aside className="game-panel" aria-label="게임 패널">
    {panels.map((panel) => <Fragment key={panel.id}>{panel.content}</Fragment>)}
  </aside>;
}
