import type { SupabaseClient } from "@supabase/supabase-js";

export function loadCurrentProfile(supabase: SupabaseClient, userId: string) {
  return supabase
    .from("profiles")
    .select("nickname, avatar_path")
    .eq("user_id", userId)
    .single();
}
