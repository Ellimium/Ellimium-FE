"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import { getLoginHrefForPath } from "./login/return-path";

export default function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    function redirectToLogin() {
      if (!active) return;
      setReady(false);
      router.replace(getLoginHrefForPath(`${window.location.pathname}${window.location.search}`));
    }

    supabase.auth.getUser()
      .then(({ data }) => {
        if (!active) return;
        if (data.user) setReady(true);
        else redirectToLogin();
      })
      .catch(() => {
        redirectToLogin();
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        redirectToLogin();
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [router]);

  return ready ? children : <main className="auth-loading" aria-busy="true">인증 상태 확인 중…</main>;
}
