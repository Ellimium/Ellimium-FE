export type SheetTab = "attributes" | "skills" | "equipment" | "notes";
export type SheetField = "attributes" | "resources" | "skills" | "equipment" | "notes" | "backstory";
export type SheetDrafts = Record<string, Partial<Record<SheetTab, Partial<Record<SheetField, string>>>>>;

export function updateSheetDraft(drafts: SheetDrafts, sheetId: string, tab: SheetTab, field: SheetField, value: string): SheetDrafts {
  return {
    ...drafts,
    [sheetId]: {
      ...drafts[sheetId],
      [tab]: { ...drafts[sheetId]?.[tab], [field]: value },
    },
  };
}

export function clearSheetDraft(drafts: SheetDrafts, sheetId: string, tab: SheetTab): SheetDrafts {
  const remaining = { ...drafts[sheetId] };
  delete remaining[tab];
  return { ...drafts, [sheetId]: remaining };
}
