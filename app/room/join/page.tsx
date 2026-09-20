"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";

export default function JoinRoom() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [requiresLogin, setRequiresLogin] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const inviteCode = new URLSearchParams(window.location.search).get("code");
    if (inviteCode) setCode(inviteCode);

    supabase.auth.getUser()
      .then(({ data }) => setRequiresLogin(!data.user || Boolean(data.user.is_anonymous)))
      .catch(() => setRequiresLogin(true))
      .finally(() => setReady(true));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const inviteCode = code.trim();

    if (!inviteCode) {
      setError("초대 코드를 입력하세요.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const { data, error: joinError } = await supabase.rpc("join_room", { room_invite_code: inviteCode });

      if (joinError) {
        if (joinError.code === "22023") setError("초대 코드가 올바르지 않습니다.");
        else if (joinError.code === "42501") setRequiresLogin(true);
        else if (!joinError.code) setError("네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도하세요.");
        else setError("룸에 참가하지 못했습니다. 잠시 후 다시 시도하세요.");
        return;
      }

      const roomId = Array.isArray(data) ? data[0] : data;
      if (typeof roomId !== "string" || !roomId) {
        setError("룸에는 참가했지만 결과를 불러오지 못했습니다. 다시 시도하세요.");
        return;
      }

      router.replace(`/room?roomId=${roomId}`);
    } catch {
      setError("네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
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

  return <main className="join-room-shell"><form className="join-room-card login-card" onSubmit={handleSubmit} aria-busy={busy}>
    <Link className="brand" href="/">ELLIMIUM</Link>
    <div className="profile-heading"><p className="eyebrow">ROOM INVITATION</p><h1>모험에 참가하기</h1></div>
    <p className="muted">초대 코드를 입력하거나 받은 초대 링크를 여세요.</p>
    <label>초대 코드 <small>필수</small><input name="code" value={code} onChange={(event) => setCode(event.target.value)} required disabled={busy} autoComplete="off" placeholder="초대 코드를 붙여 넣으세요" /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button full-button" type="submit" disabled={busy}>{busy ? "참가 중…" : "코드로 참가"}</button>
    <p className="form-foot"><Link href="/">← 캠페인으로 돌아가기</Link></p>
  </form></main>;
}
