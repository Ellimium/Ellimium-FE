"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import AuthGuard from "./auth-guard";
import LogoutButton from "./logout-button";

type Room = {
  id: string;
  name: string;
  description: string | null;
  game_system: string;
};

export default function Home() {
  return <AuthGuard><Lobby /></AuthGuard>;
}

function Lobby() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    supabase.from("rooms").select("id, name, description, game_system").order("created_at", { ascending: false })
      .then(({ data, error: roomsError }) => {
        if (!active) return;
        if (roomsError) setError("캠페인 목록을 불러오지 못했습니다.");
        else setRooms(data ?? []);
        setLoading(false);
      });

    return () => { active = false; };
  }, []);

  return (
    <main className="lobby-shell">
      <header className="topbar">
        <Link className="brand" href="/">ELLIMIUM</Link>
        <nav aria-label="주요 메뉴">
          <Link className="nav-active" href="/">캠페인</Link>
          <Link href="/assets">자산</Link>
          <Link href="/music">음악</Link>
        </nav>
        <div className="account-actions"><LogoutButton /><Link className="avatar" href="/profile" aria-label="프로필">L</Link></div>
      </header>
      <section className="lobby-hero">
        <div>
          <p className="eyebrow">YOUR CAMPAIGNS</p>
          <h1>다시, 모험을<br />이어갈 시간입니다.</h1>
          <p className="muted">최근 캠페인을 열거나 새로운 이야기를 시작하세요.</p>
        </div>
        <div className="lobby-actions"><Link className="secondary-button" href="/room/join">초대 코드로 참가</Link><Link className="primary-button" href="/room/create">＋ 새 캠페인</Link></div>
      </section>
      <section className="campaign-grid" aria-label="캠페인 목록" aria-busy={loading}>
        {loading && <p className="lobby-state muted">캠페인을 불러오는 중…</p>}
        {!loading && error && <p className="lobby-state form-error" role="alert">{error}</p>}
        {!loading && !error && rooms.length === 0 && <p className="lobby-state muted">참여 중인 캠페인이 없습니다.</p>}
        {!loading && !error && rooms.map((room) => <article className="campaign-card" key={room.id}>
          <div className="card-art ruins-art"><span>참여 중</span></div>
          <div className="card-body">
            <p className="eyebrow">{room.game_system}</p><h2>{room.name}</h2>
            <p className="muted">{room.description || "설명이 없습니다."}</p>
            <div className="card-footer"><span /><Link className="text-button" href={`/room?roomId=${room.id}`}>열기 →</Link></div>
          </div>
        </article>)}
        <Link className="campaign-card new-card" href="/room/create"><span className="new-card-icon">＋</span><strong>새 캠페인 만들기</strong><span>빈 테이블에서 시작</span></Link>
      </section>
      <footer className="lobby-footer">ELLIMIUM · PERSONAL VIRTUAL TABLETOP</footer>
    </main>
  );
}
