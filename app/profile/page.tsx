"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import AuthGuard from "../auth-guard";
import { supabase } from "@/lib/supabase/client";

export default function Profile() {
  const [userId, setUserId] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [savedEmail, setSavedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    Promise.all([
      supabase.auth.getUser(),
      supabase.from("profiles").select("nickname").single(),
    ]).then(([userResult, profileResult]) => {
      if (!active) return;
      if (userResult.error || profileResult.error || !userResult.data.user) {
        setError(userResult.error?.message ?? profileResult.error?.message ?? "프로필을 불러올 수 없습니다.");
        return;
      }

      const currentEmail = userResult.data.user.email ?? "";
      setUserId(userResult.data.user.id);
      setNickname(profileResult.data.nickname);
      setEmail(currentEmail);
      setSavedEmail(currentEmail);
    }).catch(() => {
      if (active) setError("프로필 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.");
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextNickname = nickname.trim();
    const nextEmail = email.trim();

    if (!userId || nextNickname.length < 3) {
      setError("닉네임은 3자 이상 입력하세요.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ nickname: nextNickname })
        .eq("user_id", userId);

      if (profileError) {
        setError(profileError.message);
        return;
      }

      if (nextEmail !== savedEmail || password) {
        const { error: authError } = await supabase.auth.updateUser({
          ...(nextEmail !== savedEmail && { email: nextEmail }),
          ...(password && { password }),
        });

        if (authError) {
          setError(`닉네임은 저장됐지만 계정 변경에 실패했습니다: ${authError.message}`);
          return;
        }
      }

      setNickname(nextNickname);
      setSavedEmail(nextEmail);
      setPassword("");
      setMessage(nextEmail !== savedEmail ? "저장했습니다. 이메일 변경 확인 메일을 확인하세요." : "프로필을 저장했습니다.");
    } catch {
      setError("프로필 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard><main className="profile-shell">
      <form className="login-card profile-card" onSubmit={handleSubmit} aria-busy={loading || busy}>
        <Link className="brand" href="/">ELLIMIUM</Link>
        <div className="profile-heading"><p className="eyebrow">YOUR PROFILE</p><h1>프로필 관리</h1></div>
        <label>닉네임<input value={nickname} onChange={(event) => setNickname(event.target.value)} minLength={3} maxLength={20} required autoComplete="nickname" disabled={loading} /></label>
        <label>이메일<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required autoComplete="email" disabled={loading} /></label>
        <label>새 비밀번호<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={6} placeholder="변경할 때만 입력" autoComplete="new-password" disabled={loading} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="form-message" role="status">{message}</p>}
        <button className="primary-button full-button" type="submit" disabled={loading || busy}>{loading ? "불러오는 중…" : busy ? "저장 중…" : "변경사항 저장"}</button>
        <p className="form-foot"><Link href="/">← 캠페인으로 돌아가기</Link></p>
      </form>
    </main></AuthGuard>
  );
}
