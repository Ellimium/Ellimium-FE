import { formatSheetEntries } from "./character-sheet.ts";

export type SheetTab = "attributes" | "skills" | "equipment" | "notes";
export type SheetField = "attributes" | "resources" | "skills" | "equipment" | "notes" | "backstory";
export type SheetDrafts = Record<string, Partial<Record<SheetTab, Partial<Record<SheetField, string>>>>>;

export function sheetEditValues(sheet: {
  attributes: Record<string, unknown>; resources: Record<string, unknown>; skills: Record<string, unknown>;
  equipment: unknown[]; notes: string; backstory: string;
}): Record<SheetField, string> {
  return {
    attributes: formatSheetEntries(sheet.attributes),
    resources: formatSheetEntries(sheet.resources),
    skills: formatSheetEntries(sheet.skills),
    equipment: sheet.equipment.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n"),
    notes: sheet.notes,
    backstory: sheet.backstory,
  };
}

export function hasSheetTabChanges(draft: Partial<Record<SheetField, string>> | undefined, saved: Record<SheetField, string>) {
  return Object.entries(draft ?? {}).some(([field, value]) => value !== saved[field as SheetField]);
}

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
