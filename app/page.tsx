"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import { ROOM_ACCESS_ENDED_MESSAGE } from "./room/room-access";
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
  const [accessEnded, setAccessEnded] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);

  const loadRooms = useCallback(async () => {
    if (request.current) return;
    const current = new AbortController();
    request.current = current;
    setLoading(true);

    try {
      const { data, error: roomsError } = await supabase.from("rooms")
        .select("id, name, description, game_system")
        .order("created_at", { ascending: false }).abortSignal(current.signal);
      if (current.signal.aborted) return;
      if (roomsError) throw roomsError;
      setRooms(data ?? []);
      setError("");
    } catch {
      if (!current.signal.aborted) setError("캠페인 목록을 불러오지 못했습니다.");
    } finally {
      if (!current.signal.aborted) {
        request.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    setAccessEnded(new URLSearchParams(window.location.search).get("roomAccess") === "ended");
    void loadRooms();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [loadRooms]);

  return (
    <main className="lobby-shell">
      <header className="topbar">
        <Link className="brand" href="/">ELLIMIUM</Link>
        <nav aria-label="주요 메뉴">
          <Link className="nav-active" href="/" aria-current="page">캠페인</Link>
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
      {accessEnded && <p className="lobby-state form-error" role="alert">{ROOM_ACCESS_ENDED_MESSAGE}</p>}
      <section className="campaign-grid" aria-label="캠페인 목록" aria-busy={loading}>
        {loading && <p className="lobby-state muted" role="status">캠페인을 불러오는 중…</p>}
        {error && <div className="lobby-state">
          <p className="form-error" role="alert">{error}</p>
          <button className="secondary-button" type="button" disabled={loading} onClick={() => void loadRooms()}>다시 불러오기</button>
        </div>}
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
