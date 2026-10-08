import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage } from "./chat-message.ts";

export const CHAT_HISTORY_PAGE_SIZE = 100;
const MESSAGE_FIELDS = "id, room_id, sender_id, character_id, character_name, mode, content, message_type, event_type, event_data, created_at";
export type ChatCursor = Pick<ChatMessage, "id" | "created_at">;

export async function readChatPage(client: SupabaseClient, roomId: string, before?: ChatCursor | null, since?: ChatCursor | null) {
  let query = client.from("chat_messages").select(MESSAGE_FIELDS).eq("room_id", roomId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(CHAT_HISTORY_PAGE_SIZE);
  const upper = before && `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`;
  const lower = since && `created_at.gt.${since.created_at},and(created_at.eq.${since.created_at},id.gte.${since.id})`;
  // Combine both bounds in one filter; two .or() calls would overwrite each other.
  if (upper && lower) query = query.or(`and(or(${upper}),or(${lower}))`);
  else if (upper || lower) query = query.or((upper || lower)!);
  const { data, error } = await query;
  return { data: (data ?? []) as ChatMessage[], error };
}
