export type PanelSetting = { panel_id: string; collapsed: boolean; visible: boolean; position: number };

export function defaultPanelSettings(panelIds: string[]): PanelSetting[] {
  return panelIds.map((panel_id, position) => ({ panel_id, collapsed: false, visible: true, position }));
}

export function restorePanelSettings(panelIds: string[], rows: unknown[]): PanelSetting[] {
  const saved = rows.filter((row): row is PanelSetting => {
    if (!row || typeof row !== "object") return false;
    const setting = row as Partial<PanelSetting>;
    return typeof setting.panel_id === "string" && panelIds.includes(setting.panel_id)
      && typeof setting.collapsed === "boolean" && typeof setting.visible === "boolean"
      && typeof setting.position === "number" && Number.isSafeInteger(setting.position) && setting.position >= 0;
  }).sort((a, b) => a.position - b.position || (a.panel_id < b.panel_id ? -1 : a.panel_id > b.panel_id ? 1 : 0));
  const missing = defaultPanelSettings(panelIds.filter((id) => !saved.some((setting) => setting.panel_id === id)));
  return [...saved, ...missing].map((setting, position) => ({ ...setting, position }));
}

export function movePanel(settings: PanelSetting[], panelId: string, direction: -1 | 1): PanelSetting[] {
  const index = settings.findIndex((setting) => setting.panel_id === panelId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= settings.length) return settings;
  const reordered = [...settings];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return reordered.map((setting, position) => ({ ...setting, position }));
}
