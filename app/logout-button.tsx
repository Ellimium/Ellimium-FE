"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { supabase } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setBusy(true);
    setError("");

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        setError(error.message);
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch {
      setError("인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="logout"><button className="link-button" type="button" onClick={logout} disabled={busy}>{busy ? "처리 중…" : "로그아웃"}</button>{error && <span role="alert">{error}</span>}</div>;
}
