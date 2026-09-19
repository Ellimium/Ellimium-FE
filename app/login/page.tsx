"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { supabase } from "@/lib/supabase/client";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const nickname = String(form.get("nickname") ?? "");

    try {
      const result = mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { nickname } } });

      if (result.error) {
        setError(result.error.message);
      } else if (result.data.session) {
        router.replace("/");
        router.refresh();
      } else {
        setMessage("확인 이메일의 링크를 열어 가입을 완료하세요.");
      }
    } catch {
      setError("인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  }

  function changeMode() {
    setMode(mode === "login" ? "signup" : "login");
    setError("");
    setMessage("");
  }

  return (
    <main className="login-shell">
      <section className="login-story">
        <Link className="brand" href="/">ELLIMIUM</Link>
        <div><p className="eyebrow">A PRIVATE VIRTUAL TABLETOP</p><h1>이야기가 머무는<br />우리만의 테이블.</h1><p>지도와 주사위, 캐릭터와 기록을 한곳에서.</p></div>
        <small>© 2026 ELLIMIUM</small>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={handleSubmit}>
          <p className="eyebrow">{mode === "login" ? "WELCOME BACK" : "JOIN THE TABLE"}</p>
          <h2>{mode === "login" ? "모험으로 돌아가기" : "새 모험 시작하기"}</h2>
          {mode === "signup" && <label>닉네임<input name="nickname" minLength={3} maxLength={20} required autoComplete="nickname" /></label>}
          <label>이메일<input name="email" type="email" placeholder="adventurer@example.com" autoComplete="email" required /></label>
          <label>비밀번호<input name="password" type="password" minLength={6} placeholder="••••••••" autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="form-message" role="status">{message}</p>}
          <button className="primary-button full-button" type="submit" disabled={busy}>{busy ? "처리 중…" : mode === "login" ? "로그인" : "가입"}</button>
          <p className="form-foot">{mode === "login" ? "계정이 없나요?" : "이미 계정이 있나요?"} <button className="link-button" type="button" onClick={changeMode}>{mode === "login" ? "회원가입" : "로그인"}</button></p>
        </form>
      </section>
    </main>
  );
}
