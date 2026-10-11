import type { SupabaseClient } from "@supabase/supabase-js";
import { compareDiceRolls, mergeDiceRolls } from "./dice-log.ts";
import type { DiceRollLog } from "./dice-log.ts";

export const DICE_HISTORY_PAGE_SIZE = 100;
export type DiceCursor = Pick<DiceRollLog, "id" | "created_at">;
const ROLL_FIELDS = "id, room_id, roller_id, expression, individual_results, total, visibility, character_sheet_id, sheet_roll, created_at";
const NOTIFICATION_FIELDS = "id, room_id, roller_id, visibility, created_at";

export async function readDicePage(client: SupabaseClient, roomId: string, before?: DiceCursor | null, since?: DiceCursor | null) {
  const results = await Promise.all((["dice_rolls", "dice_roll_notifications"] as const).map(async (table) => {
    const selection = table === "dice_rolls"
      ? client.from(table).select(ROLL_FIELDS)
      : client.from(table).select(NOTIFICATION_FIELDS);
    let query = selection.eq("room_id", roomId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(DICE_HISTORY_PAGE_SIZE);
    const upper = before && `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`;
    const lower = since && `created_at.gt.${since.created_at},and(created_at.eq.${since.created_at},id.gte.${since.id})`;
    if (upper && lower) query = query.or(`and(or(${upper}),or(${lower}))`);
    else if (upper || lower) query = query.or((upper || lower)!);
    const { data, error } = await query;
    return { data: (data ?? []) as DiceRollLog[], error };
  }));
  const error = results.find((result) => result.error)?.error ?? null;
  const merged = mergeDiceRolls(results[1].data, results[0].data).sort((a, b) => compareDiceRolls(b, a));
  return {
    data: error ? [] : merged.slice(0, DICE_HISTORY_PAGE_SIZE), error,
    hasMore: !error && (merged.length > DICE_HISTORY_PAGE_SIZE || results.some((result) => result.data.length === DICE_HISTORY_PAGE_SIZE)),
  };
}
