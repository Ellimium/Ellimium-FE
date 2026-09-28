export type DiceRollLog = {
  id: string;
  roller_id: string;
  expression: string;
  individual_results: unknown;
  total: number | string;
  created_at: string;
};

export type DiceSort = "asc" | "desc";

export function resultsText(results: unknown) {
  return Array.isArray(results) ? results.join(" + ") : String(results);
}

export function visibleDiceRolls(rolls: DiceRollLog[], rollerNames: Record<string, string>, rollerId: string, search: string, sort: DiceSort) {
  const query = search.trim().toLocaleLowerCase("ko");

  return [...rolls]
    .filter((roll) => !rollerId || roll.roller_id === rollerId)
    .filter((roll) => !query || [rollerNames[roll.roller_id], roll.expression, resultsText(roll.individual_results), roll.total]
      .some((value) => String(value ?? "").toLocaleLowerCase("ko").includes(query)))
    .sort((left, right) => (Date.parse(left.created_at) - Date.parse(right.created_at)) * (sort === "asc" ? 1 : -1) || left.id.localeCompare(right.id));
}
