export type PanelSetting = { panel_id: string; collapsed: boolean; visible: boolean; position: number };

export function defaultPanelSettings(panelIds: string[]): PanelSetting[] {
  return panelIds.map((panel_id, position) => ({ panel_id, collapsed: false, visible: true, position }));
}

export function movePanel(settings: PanelSetting[], panelId: string, direction: -1 | 1): PanelSetting[] {
  const index = settings.findIndex((setting) => setting.panel_id === panelId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= settings.length) return settings;
  const reordered = [...settings];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return reordered.map((setting, position) => ({ ...setting, position }));
}
