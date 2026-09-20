"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";

export default function JoinRoom() {
  const [code, setCode] = useState("");
  const [requiresLogin, setRequiresLogin] = useState(true);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const inviteCode = new URLSearchParams(window.location.search).get("code");
    if (inviteCode) setCode(inviteCode);

    supabase.auth.getUser()
      .then(({ data }) => setRequiresLogin(!data.user || Boolean(data.user.is_anonymous)))
      .catch(() => setRequiresLogin(true))
      .finally(() => setReady(true));
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("초대 코드가 준비되었습니다. 참가 처리는 다음 단계에서 연결됩니다.");
  }

  if (!ready) return <main className="auth-loading" aria-busy="true">인증 상태 확인 중…</main>;

  if (requiresLogin) {
    return <main className="join-room-shell"><section className="join-room-card login-card">
      <Link className="brand" href="/">ELLIMIUM</Link>
      <div className="profile-heading"><p className="eyebrow">ROOM INVITATION</p><h1>등록 계정으로<br />로그인하세요.</h1></div>
      <p className="muted">룸 참가에는 이메일로 가입한 Ellimium 계정이 필요합니다. 익명 로그인은 사용할 수 없습니다.</p>
      <Link className="primary-button full-button" href="/login">등록 계정으로 로그인</Link>
      <p className="form-foot"><Link href="/">← 캠페인으로 돌아가기</Link></p>
    </section></main>;
  }

  return <main className="join-room-shell"><form className="join-room-card login-card" onSubmit={handleSubmit}>
    <Link className="brand" href="/">ELLIMIUM</Link>
    <div className="profile-heading"><p className="eyebrow">ROOM INVITATION</p><h1>모험에 참가하기</h1></div>
    <p className="muted">초대 코드를 입력하거나 받은 초대 링크를 여세요.</p>
    <label>초대 코드 <small>필수</small><input name="code" value={code} onChange={(event) => setCode(event.target.value)} required autoComplete="off" placeholder="초대 코드를 붙여 넣으세요" /></label>
    {message && <p className="form-message" role="status">{message}</p>}
    <button className="primary-button full-button" type="submit">코드로 참가</button>
    <p className="form-foot"><Link href="/">← 캠페인으로 돌아가기</Link></p>
  </form></main>;
}
