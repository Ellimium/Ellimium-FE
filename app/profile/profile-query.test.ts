import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadCurrentProfile } from "./profile-query.ts";

test("loads only the authenticated user's profile when room members are visible", async () => {
  const profiles = [
    { user_id: "current-user", nickname: "현재 사용자", avatar_path: null },
    { user_id: "room-member", nickname: "룸 구성원", avatar_path: null },
  ];
  let filteredProfiles = profiles;
  const supabase = {
    from: () => ({
      select: () => ({
        eq: (column: string, value: string) => ({
          single: async () => {
            filteredProfiles = profiles.filter((profile) => profile[column as keyof typeof profile] === value);
            return filteredProfiles.length === 1
              ? { data: filteredProfiles[0], error: null }
              : { data: null, error: new Error("Cannot coerce the result to a single JSON object") };
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;

  const result = await loadCurrentProfile(supabase, "current-user");

  assert.equal(result.error, null);
  assert.equal(result.data?.nickname, "현재 사용자");
  assert.deepEqual(filteredProfiles.map((profile) => profile.user_id), ["current-user"]);
});
