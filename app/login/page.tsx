"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import { getAuthErrorMessage } from "./auth-errors";
import { getSafeReturnPath } from "./return-path";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup" | "recovery">("login");
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "recovery") setMode("recovery");
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const nickname = String(form.get("nickname") ?? "");

    try {
      if (mode === "recovery") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login/reset-password`,
        });
        if (error) setError(getAuthErrorMessage(error));
        else setMessage("입력한 이메일로 등록된 계정이 있다면 비밀번호 복구 메일을 보냈습니다. 받은편지함과 스팸함을 확인하세요.");
        return;
      }
      const result = mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { nickname } } });

      if (result.error) {
        setError(getAuthErrorMessage(result.error));
      } else if (result.data.session) {
        const returnTo = getSafeReturnPath(new URLSearchParams(window.location.search).get("returnTo"));
        router.replace(returnTo);
        router.refresh();
      } else {
        setMessage("확인 이메일의 링크를 열어 가입을 완료하세요.");
      }
    } catch (error) {
      setError(getAuthErrorMessage(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function changeMode(nextMode: typeof mode) {
    if (submitting.current) return;
    setMode(nextMode);
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
          <p className="eyebrow">{mode === "recovery" ? "PASSWORD RECOVERY" : mode === "login" ? "WELCOME BACK" : "JOIN THE TABLE"}</p>
          <h2>{mode === "recovery" ? "비밀번호 복구" : mode === "login" ? "모험으로 돌아가기" : "새 모험 시작하기"}</h2>
          {mode === "recovery" && <p>가입할 때 사용한 이메일 주소를 입력하세요.</p>}
          {mode === "signup" && <label>닉네임<input name="nickname" minLength={3} maxLength={20} required autoComplete="nickname" /></label>}
          <label>이메일<input name="email" type="email" placeholder="adventurer@example.com" autoComplete="email" required /></label>
          {mode !== "recovery" && <label>비밀번호<input name="password" type="password" minLength={6} placeholder="••••••••" autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="form-message" role="status">{message}</p>}
          <button className="primary-button full-button" type="submit" disabled={busy}>{busy ? "처리 중…" : mode === "recovery" ? "복구 메일 요청" : mode === "login" ? "로그인" : "가입"}</button>
          {mode === "login" && <p className="form-foot"><button className="link-button" type="button" disabled={busy} onClick={() => changeMode("recovery")}>비밀번호를 잊으셨나요?</button></p>}
          <p className="form-foot">{mode === "recovery" ? "로그인 화면으로 돌아가기" : mode === "login" ? "계정이 없나요?" : "이미 계정이 있나요?"} <button className="link-button" type="button" disabled={busy} onClick={() => changeMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "회원가입" : "로그인"}</button></p>
        </form>
      </section>
    </main>
  );
}
