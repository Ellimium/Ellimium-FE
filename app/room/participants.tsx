"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import { useRoomPermissions } from "./room-permissions";
import type { RoomMember } from "./room-membership";

type Member = RoomMember;
type Profile = { user_id: string; nickname: string; avatar_path: string | null };
type Participant = Member & { nickname: string; avatarUrl: string };

const roleName = { master: "마스터", player: "플레이어", spectator: "관전자" };

export default function Participants({ roomId }: { roomId?: string }) {
  const { members, currentUserId, role, loading: membershipLoading, checking, error: membershipError, refreshMembership } = useRoomPermissions();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(Boolean(roomId));
  const [error, setError] = useState("");
  const [pendingUserId, setPendingUserId] = useState("");

  useEffect(() => {
    let active = true;

    if (!roomId) {
      setParticipants([]);
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError("");
      setParticipants((current) => current.flatMap((participant) => {
        const member = members.find((member) => member.user_id === participant.user_id);
        return member ? [{ ...participant, role: member.role }] : [];
      }));

      if (!members.length) {
        setParticipants([]);
        setLoading(false);
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("user_id, nickname, avatar_path")
        .in("user_id", members.map((member) => member.user_id));

      if (profileError || !active) {
        if (active) {
          setError(profileError?.message ?? "참가자 프로필을 불러올 수 없습니다.");
          setLoading(false);
        }
        return;
      }

      const profiles = new Map(((profileData ?? []) as Profile[]).map((profile) => [profile.user_id, profile]));
      const nextParticipants = await Promise.all(members.map(async (member) => {
        const profile = profiles.get(member.user_id);
        const { data } = profile?.avatar_path
          ? await supabase.storage.from("avatars").createSignedUrl(profile.avatar_path, 60 * 60)
          : { data: null };

        return {
          ...member,
          nickname: profile?.nickname ?? "알 수 없는 사용자",
          avatarUrl: data?.signedUrl ?? "",
        };
      }));

      if (active) {
        setParticipants(nextParticipants);
        setLoading(false);
      }
    }

    void load().catch(() => {
      if (active) {
        setError("참가자 프로필 서버에 연결하지 못했습니다.");
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [members, roomId]);

  const isMaster = role === "master" && !membershipLoading && !checking && !membershipError;

  async function changeRole(userId: string, role: Member["role"]) {
    if (!roomId || !isMaster || pendingUserId) return;

    setPendingUserId(userId);
    setError("");
    try {
      const { error: updateError } = await supabase.rpc("set_room_member_role", {
        target_room_id: roomId,
        target_user_id: userId,
        target_role: role,
      });
      if (updateError) setError(updateError.message);
      else await refreshMembership();
    } catch {
      setError("참가자 관리 서버에 연결하지 못했습니다.");
    } finally {
      setPendingUserId("");
    }
  }

  async function forceRemove(userId: string) {
    if (!roomId || !isMaster || pendingUserId) return;

    setPendingUserId(userId);
    setError("");
    try {
      const { error: removeError } = await supabase.rpc("force_remove_room_member", {
        target_room_id: roomId,
        target_user_id: userId,
      });
      if (removeError) setError(removeError.message);
      else await refreshMembership();
    } catch {
      setError("참가자 관리 서버에 연결하지 못했습니다.");
    } finally {
      setPendingUserId("");
    }
  }

  return (
    <section className="participants" aria-label="참가자 목록">
      <div className="panel-heading"><div><p className="eyebrow">PARTY</p><h2>참가자</h2></div><span>{loading || membershipLoading ? "불러오는 중" : `${participants.length}명`}</span></div>
      {!roomId && <p className="system-message">룸을 선택하면 참가자를 표시합니다.</p>}
      {membershipError && <p className="form-error" role="alert">{membershipError}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <ul className="participant-list">
        {participants.map((participant) => (
          <li key={participant.user_id}>
            <i className="participant-avatar">{participant.avatarUrl ? <img src={participant.avatarUrl} alt="" /> : participant.nickname.slice(0, 1)}</i>
            <span><strong>{participant.nickname}</strong><small>{roleName[participant.role]}</small></span>
            {isMaster && participant.user_id !== currentUserId && <div className="participant-actions">
              <select value={participant.role} disabled={Boolean(pendingUserId)} aria-label={`${participant.nickname} 역할`} onChange={(event) => { void changeRole(participant.user_id, event.target.value as Member["role"]); }}>
                {Object.entries(roleName).map(([role, name]) => <option key={role} value={role}>{name}</option>)}
              </select>
              <button type="button" disabled={Boolean(pendingUserId)} aria-label={`${participant.nickname} 강제 퇴장`} onClick={() => { void forceRemove(participant.user_id); }}>퇴장</button>
            </div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
