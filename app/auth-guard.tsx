"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";

export default function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getUser()
      .then(({ data }) => {
        if (!active) return;
        if (data.user) setReady(true);
        else router.replace("/login");
      })
      .catch(() => {
        if (active) router.replace("/login");
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setReady(false);
        router.replace("/login");
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [router]);

  return ready ? children : <main className="auth-loading" aria-busy="true">인증 상태 확인 중…</main>;
}
