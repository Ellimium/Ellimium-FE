"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import AuthGuard from "../../auth-guard";
import { supabase } from "@/lib/supabase/client";

type CreatedRoom = {
  id: string;
};

export default function CreateRoom() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const gameSystem = String(form.get("gameSystem") ?? "").trim();

    setError("");

    if (!name || !gameSystem) {
      setError("룸 이름과 TRPG 시스템을 입력하세요.");
      return;
    }

    setBusy(true);

    try {
      const { data, error: createError } = await supabase.rpc("create_room", {
        room_name: name,
        room_description: description || null,
        room_game_system: gameSystem,
      });

      if (createError) {
        if (createError.code === "22023") setError("입력값의 길이와 필수 항목을 확인하세요.");
        else if (!createError.code) setError("네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도하세요.");
        else setError("룸을 생성하지 못했습니다. 잠시 후 다시 시도하세요.");
        return;
      }

      const createdRoom = (Array.isArray(data) ? data[0] : data) as CreatedRoom | null;
      if (!createdRoom?.id) {
        setError("룸은 생성됐지만 결과를 불러오지 못했습니다.");
        return;
      }

      router.replace(`/room?roomId=${createdRoom.id}`);
    } catch {
      setError("네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard><main className="create-room-shell">
      <form className="login-card create-room-card" onSubmit={handleSubmit} aria-busy={busy}>
        <Link className="brand" href="/">ELLIMIUM</Link>
        <div className="profile-heading"><p className="eyebrow">CREATE A ROOM</p><h1>새로운 모험 준비</h1></div>
        <label>룸 이름 <small>필수 · 1~50자</small><input name="name" minLength={1} maxLength={50} required disabled={busy} /></label>
        <label>룸 설명 <small>선택 · 최대 500자</small><textarea name="description" maxLength={500} rows={5} disabled={busy} /></label>
        <label>TRPG 시스템 <small>필수 · 1~50자</small><input name="gameSystem" list="game-systems" minLength={1} maxLength={50} required disabled={busy} /></label>
        <datalist id="game-systems"><option value="D&D 5e" /><option value="CoC 7th" /></datalist>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-button" type="submit" disabled={busy}>{busy ? "생성 중…" : "룸 생성"}</button>
        <p className="form-foot"><Link href="/">← 캠페인으로 돌아가기</Link></p>
      </form>
    </main></AuthGuard>
  );
}
