import type { SupabaseClient } from "@supabase/supabase-js";
import { isRoomFeaturePermission, type RoomFeaturePermission, type RoomRole } from "./room-permission.ts";

export type RoomMember = { user_id: string; role: RoomRole };
export type RoomMembershipView = {
  userId: string | null;
  role: RoomRole | null;
  members: RoomMember[];
  rows: RoomFeaturePermission[];
  checking: boolean;
  error: string;
};

export function startRoomMembershipSync(
  client: SupabaseClient,
  roomId: string,
  changed: (view: RoomMembershipView) => void,
  browser: { window: EventTarget; document: EventTarget & { visibilityState: string } },
) {
  let disposed = false;
  let version = 0;
  let view: RoomMembershipView = { userId: null, role: null, members: [], rows: [], checking: false, error: "" };
  function publish(patch: Partial<RoomMembershipView>) {
    if (disposed) return;
    view = { ...view, ...patch };
    changed(view);
  }
  function invalidate(message: string) {
    version++;
    publish({ role: null, members: [], rows: [], checking: false, error: message });
  }
  async function refresh() {
    if (disposed) return;
    const request = ++version;
    publish({ checking: true });
    try {
      const { data: { user }, error: authError } = await client.auth.getUser();
      if (disposed || request !== version) return;
      if (authError || !user) throw new Error("룸 기능 권한을 확인할 수 없습니다.");
      const [members, permissions] = await Promise.all([
        client.from("room_members").select("user_id, role").eq("room_id", roomId).eq("status", "active").order("joined_at"),
        client.from("room_feature_permissions").select("id, room_id, feature, role, user_id, allowed").eq("room_id", roomId),
      ]);
      if (disposed || request !== version) return;
      if (members.error || permissions.error) throw new Error("룸 기능 권한과 참가자 목록을 불러오지 못했습니다.");
      const activeMembers = (members.data ?? []).filter((member): member is RoomMember =>
        typeof member.user_id === "string" && ["master", "player", "spectator"].includes(member.role));
      const role = activeMembers.find((member) => member.user_id === user.id)?.role ?? null;
      publish({ userId: user.id, role, members: role ? activeMembers : [], rows: role ? (permissions.data ?? []).filter(isRoomFeaturePermission) : [], checking: false, error: "" });
    } catch (error) {
      if (!disposed && request === version) invalidate(error instanceof Error ? error.message : "룸 권한 서버에 연결하지 못했습니다.");
    }
  }
  const channel = client.channel(`room:${roomId}:membership`)
    .on("postgres_changes", { event: "*", schema: "public", table: "room_feature_permissions", filter: `room_id=eq.${roomId}` }, () => { void refresh(); })
    .subscribe((status) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") void refresh();
      else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) invalidate("룸 권한 실시간 연결이 끊겼습니다. 다시 확인하는 중입니다.");
    });
  // room_members is not published; removed members also cannot read its changes under RLS.
  // ponytail: poll every 5 seconds; use backend membership notifications for lower latency.
  // Poll the authoritative snapshot until a backend membership notification is available.
  const timer = setInterval(() => {
    if (browser.document.visibilityState === "visible" && !view.checking) void refresh();
  }, 5000);
  const online = () => { void refresh(); };
  const offline = () => invalidate("룸 권한 서버에 연결하지 못했습니다.");
  const visible = () => { if (browser.document.visibilityState === "visible") void refresh(); };
  browser.window.addEventListener("online", online);
  browser.window.addEventListener("offline", offline);
  browser.document.addEventListener("visibilitychange", visible);
  void refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      version++;
      clearInterval(timer);
      browser.window.removeEventListener("online", online);
      browser.window.removeEventListener("offline", offline);
      browser.document.removeEventListener("visibilitychange", visible);
      void client.removeChannel(channel);
    },
  };
}
