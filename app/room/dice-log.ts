import type { SheetRollResult } from "./character-sheet";

export type DiceRollLog = {
  id: string;
  room_id: string;
  roller_id: string;
  visibility: DiceVisibility;
  expression?: string;
  individual_results?: unknown;
  total?: number | string;
  character_sheet_id?: string | null;
  sheet_roll?: (SheetRollResult["sheet_roll"] & { modifier?: number | null }) | null;
  created_at: string;
};

export type DiceSort = "asc" | "desc";
export type DiceVisibility = "public" | "private";

export function resultsText(results: unknown) {
  return Array.isArray(results) ? results.join(" + ") : String(results);
}

export function diceRollDisplay(roll: DiceRollLog) {
  const visibility = roll.visibility === "private" ? "비공개" : "공개";
  if (roll.expression === undefined || roll.total === undefined) {
    return { total: "?", summary: `비공개 굴림 · ${visibility}`, results: "결과는 마스터와 굴린 사용자에게만 공개됩니다." };
  }
  const snapshot = roll.sheet_roll;
  let context = "";
  if (snapshot) {
    const check = snapshot.system === "coc_7e"
      ? `기준 ${snapshot.value} · ${Number(roll.total) <= snapshot.value ? "성공" : "실패"}`
      : snapshot.modifier === undefined || snapshot.modifier === null ? "" : `수정치 ${snapshot.modifier >= 0 ? "+" : ""}${snapshot.modifier}`;
    context = `${snapshot.character_name} · ${snapshot.item_key}${check ? ` (${check})` : ""} · `;
  }
  return { total: String(roll.total), summary: `${context}${roll.expression} · ${visibility}`, results: resultsText(roll.individual_results) };
}

export function mergeDiceRolls(current: DiceRollLog[], incoming: DiceRollLog | DiceRollLog[]) {
  const merged = new Map(current.map((roll) => [roll.id, roll]));
  for (const roll of Array.isArray(incoming) ? incoming : [incoming]) {
    merged.set(roll.id, { ...merged.get(roll.id), ...roll });
  }
  return [...merged.values()];
}

export function compareDiceRolls(left: DiceRollLog, right: DiceRollLog) {
  return Date.parse(left.created_at) - Date.parse(right.created_at)
    || (left.created_at.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").localeCompare((right.created_at.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0"))
    || left.id.localeCompare(right.id);
}

export function visibleDiceRolls(rolls: DiceRollLog[], rollerNames: Record<string, string>, rollerId: string, visibility: "" | DiceVisibility, search: string, sort: DiceSort) {
  const query = search.trim().toLocaleLowerCase("ko");

  return [...rolls]
    .filter((roll) => !rollerId || roll.roller_id === rollerId)
    .filter((roll) => !visibility || roll.visibility === visibility)
    .filter((roll) => !query || [rollerNames[roll.roller_id], roll.expression, roll.individual_results === undefined ? "" : resultsText(roll.individual_results), roll.total, diceRollDisplay(roll).summary]
      .some((value) => String(value ?? "").toLocaleLowerCase("ko").includes(query)))
    .sort((left, right) => compareDiceRolls(left, right) * (sort === "asc" ? 1 : -1));
}
