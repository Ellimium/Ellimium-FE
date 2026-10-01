"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";

type RoomInfo = {
  name: string;
  game_system: string;
  invite_code: string;
};

export default function RoomHeader({ roomId }: { roomId?: string }) {
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    if (!roomId) return;
    let active = true;

    async function load() {
      try {
        const { data, error: roomError } = await supabase.from("rooms").select("name, game_system, invite_code").eq("id", roomId).single();
        if (!active) return;
        if (roomError) setError("룸 정보를 불러오지 못했습니다.");
        else setRoom(data);
      } catch {
        if (active) setError("룸 서버에 연결할 수 없습니다.");
      }
    }

    void load();
    return () => { active = false; };
  }, [roomId]);

  async function copyInviteLink() {
    if (!room) return;

    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/join?code=${encodeURIComponent(room.invite_code)}`);
      setCopyStatus("초대 링크를 복사했습니다.");
    } catch {
      setCopyStatus("복사하지 못했습니다. 코드를 직접 복사하세요.");
    }
  }

  return <>
    <div className="room-title"><strong>{room?.name ?? "플레이 룸"}</strong><span>{room?.game_system ?? (error || "룸 정보 불러오는 중…")}</span></div>
    <div className="room-actions">
      <span className="live-dot">연결됨</span>
      <button type="button" disabled={!room} aria-expanded={open} onClick={() => { setOpen(!open); setCopyStatus(""); }}>초대 코드</button>
      <Link href="/">나가기</Link>
      {open && room && <section className="invite-popover" aria-label="룸 초대">
        <strong>초대 코드</strong>
        <code>{room.invite_code}</code>
        <input value={`${window.location.origin}/room/join?code=${encodeURIComponent(room.invite_code)}`} readOnly aria-label="초대 링크" />
        <button type="button" onClick={copyInviteLink}>초대 링크 복사</button>
        {copyStatus && <small role="status">{copyStatus}</small>}
      </section>}
    </div>
  </>;
}
