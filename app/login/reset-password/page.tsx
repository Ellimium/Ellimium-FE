"use client";

import { AuthClient } from "@supabase/supabase-js";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

import { getAuthErrorMessage } from "../auth-errors";
import { getRecoveryTokens } from "./recovery-link";

const invalidLinkMessage = "복구 링크가 만료되었거나 올바르지 않습니다. 복구 메일을 다시 요청하세요.";

function isInvalidSession(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error &&
    (error.status === 400 || error.status === 401 || error.status === 403);
}

export default function ResetPassword() {
  const [status, setStatus] = useState<"checking" | "ready" | "invalid" | "failed" | "done">("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const client = useRef<{ auth: InstanceType<typeof AuthClient>; pending: Promise<unknown> } | null>(null);
  const tokens = useRef<ReturnType<typeof getRecoveryTokens>>(null);
  const submitting = useRef(false);
  const generation = useRef(0);

  function disposeClient() {
    const previous = client.current;
    client.current = null;
    // Initialization can register listeners late; dispose after all auth work finishes.
    if (previous) void previous.pending.then(() => previous.auth.dispose());
  }

  async function checkSession(isActive = () => true) {
    const currentGeneration = generation.current;
    const isCurrent = () => isActive() && generation.current === currentGeneration;
    setStatus("checking");
    setError("");
    if (!tokens.current || !client.current) {
      setStatus("invalid");
      setError(invalidLinkMessage);
      return;
    }
    try {
      const recovery = client.current;
      const request = recovery.auth.setSession(tokens.current);
      recovery.pending = Promise.allSettled([recovery.pending, request]);
      const { data, error } = await request;
      if (!isCurrent()) return;
      if (error || !data.session) {
        setStatus(error && !isInvalidSession(error) ? "failed" : "invalid");
        setError(error && !isInvalidSession(error) ? getAuthErrorMessage(error) : invalidLinkMessage);
      } else {
        setStatus("ready");
      }
    } catch (error) {
      if (!isCurrent()) return;
      setStatus("failed");
      setError(getAuthErrorMessage(error));
    }
  }

  useEffect(() => {
    let active = true;
    function initialize(fromHashChange = false) {
      disposeClient();
      // Keep recovery credentials in memory, separate from any existing login session.
      tokens.current = fromHashChange ? getRecoveryTokens(window.location.hash) : tokens.current ?? getRecoveryTokens(window.location.hash);
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const auth = new AuthClient({
        url: `${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "")}/auth/v1`,
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        persistSession: false, detectSessionInUrl: false, autoRefreshToken: false,
      });
      client.current = { auth, pending: Promise.allSettled([auth.getSession()]) };
      generation.current++;
      void checkSession(() => active);
    }
    const handleHashChange = () => initialize(true);
    initialize();
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      active = false;
      generation.current++;
      window.removeEventListener("hashchange", handleHashChange);
      disposeClient();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status !== "ready" || !client.current || submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get("password") ?? "");
    if (password.length < 6 || password !== form.get("confirmPassword")) {
      setError(password.length < 6 ? "비밀번호는 6자 이상 입력하세요." : "두 비밀번호가 일치하지 않습니다.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    const currentGeneration = generation.current;
    try {
      const recovery = client.current;
      const request = recovery.auth.updateUser({ password });
      recovery.pending = Promise.allSettled([recovery.pending, request]);
      const { error } = await request;
      if (generation.current !== currentGeneration) return;
      if (error) {
        if (isInvalidSession(error) && error.code !== "same_password") {
          setStatus("invalid");
          setError(invalidLinkMessage);
        } else {
          setError(error.code === "same_password" ? "기존 비밀번호와 다른 새 비밀번호를 입력하세요." : getAuthErrorMessage(error));
        }
      } else {
        formElement.reset();
        tokens.current = null;
        disposeClient();
        setStatus("done");
      }
    } catch (error) {
      if (generation.current === currentGeneration) setError(getAuthErrorMessage(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-story">
        <Link className="brand" href="/">ELLIMIUM</Link>
        <div><p className="eyebrow">A PRIVATE VIRTUAL TABLETOP</p><h1>이야기가 머무는<br />우리만의 테이블.</h1><p>지도와 주사위, 캐릭터와 기록을 한곳에서.</p></div>
        <small>© 2026 ELLIMIUM</small>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <p className="eyebrow">PASSWORD RECOVERY</p>
          <h2>새 비밀번호 설정</h2>
          {status === "checking" && <p role="status">복구 링크 확인 중…</p>}
          {status === "ready" && <form onSubmit={handleSubmit}>
            <label>새 비밀번호<input name="password" type="password" minLength={6} autoComplete="new-password" required disabled={busy} /></label>
            <label>새 비밀번호 확인<input name="confirmPassword" type="password" minLength={6} autoComplete="new-password" required disabled={busy} /></label>
            <button className="primary-button full-button" type="submit" disabled={busy}>{busy ? "변경 중…" : "비밀번호 변경"}</button>
          </form>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {status === "failed" && <button className="primary-button full-button" type="button" onClick={() => void checkSession()}>복구 링크 다시 확인</button>}
          {status === "done" && <p className="form-message" role="status">비밀번호를 변경했습니다. 새 비밀번호로 로그인하세요.</p>}
          {status !== "done" && <p className="form-foot"><Link className="link-button" href="/login?mode=recovery">복구 메일 다시 요청</Link></p>}
          <p className="form-foot"><Link className="link-button" href="/login">로그인으로 돌아가기</Link></p>
        </div>
      </section>
    </main>
  );
}
