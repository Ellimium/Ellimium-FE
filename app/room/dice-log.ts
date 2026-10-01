export type DiceRollLog = {
  id: string;
  room_id: string;
  roller_id: string;
  visibility: DiceVisibility;
  expression?: string;
  individual_results?: unknown;
  total?: number | string;
  created_at: string;
};

export type DiceSort = "asc" | "desc";
export type DiceVisibility = "public" | "private";

export function resultsText(results: unknown) {
  return Array.isArray(results) ? results.join(" + ") : String(results);
}

export function diceRollDisplay(roll: DiceRollLog) {
  const visibility = roll.visibility === "private" ? "비공개" : "공개";
  return roll.expression === undefined || roll.total === undefined
    ? { total: "?", summary: `비공개 굴림 · ${visibility}`, results: "결과는 마스터와 굴린 사용자에게만 공개됩니다." }
    : { total: String(roll.total), summary: `${roll.expression} · ${visibility}`, results: resultsText(roll.individual_results) };
}

export function mergeDiceRolls(current: DiceRollLog[], incoming: DiceRollLog | DiceRollLog[]) {
  const merged = new Map(current.map((roll) => [roll.id, roll]));
  for (const roll of Array.isArray(incoming) ? incoming : [incoming]) {
    merged.set(roll.id, { ...merged.get(roll.id), ...roll });
  }
  return [...merged.values()];
}

export function visibleDiceRolls(rolls: DiceRollLog[], rollerNames: Record<string, string>, rollerId: string, visibility: "" | DiceVisibility, search: string, sort: DiceSort) {
  const query = search.trim().toLocaleLowerCase("ko");

  return [...rolls]
    .filter((roll) => !rollerId || roll.roller_id === rollerId)
    .filter((roll) => !visibility || roll.visibility === visibility)
    .filter((roll) => !query || [rollerNames[roll.roller_id], roll.expression, roll.individual_results === undefined ? "" : resultsText(roll.individual_results), roll.total]
      .some((value) => String(value ?? "").toLocaleLowerCase("ko").includes(query)))
    .sort((left, right) => (Date.parse(left.created_at) - Date.parse(right.created_at)) * (sort === "asc" ? 1 : -1) || left.id.localeCompare(right.id));
}
