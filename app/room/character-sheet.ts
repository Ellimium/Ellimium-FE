export type SheetSystem = "dnd_5e" | "coc_7e" | "custom";

export const SHEET_SYSTEMS: Record<SheetSystem, { label: string; fields: readonly string[] }> = {
  dnd_5e: { label: "D&D 5e", fields: ["STR", "DEX", "CON", "INT", "WIS", "CHA"] },
  coc_7e: { label: "CoC 7판", fields: ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU"] },
  custom: { label: "사용자 정의", fields: [] },
};

export function buildAttributes(system: SheetSystem, values: Record<string, string>, custom = "") {
  if (system !== "custom") {
    return Object.fromEntries(SHEET_SYSTEMS[system].fields.map((field) => {
      const value = values[field]?.trim();
      if (!value || !Number.isFinite(Number(value))) throw new Error("모든 기본 능력치에 숫자를 입력하세요.");
      return [field, Number(value)];
    }));
  }

  const attributes: Record<string, string | number> = {};
  for (const line of custom.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const separator = line.indexOf("=");
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (separator < 1 || !value) throw new Error("사용자 정의 항목을 '이름=값' 형식으로 입력하세요.");
    if (name in attributes) throw new Error("사용자 정의 항목 이름은 중복될 수 없습니다.");
    attributes[name] = Number.isFinite(Number(value)) ? Number(value) : value;
  }
  if (!Object.keys(attributes).length) throw new Error("사용자 정의 항목을 한 개 이상 입력하세요.");
  return attributes;
}
