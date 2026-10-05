"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { emptyJukeboxView, jukeboxAccess, startJukeboxSync, type JukeboxCommand, type JukeboxView } from "./jukebox";

type ContextValue = JukeboxView & {
  refresh: () => Promise<void>;
  control: (command: JukeboxCommand) => Promise<void>;
};
const RoomJukeboxContext = createContext<ContextValue | null>(null);

export function RoomJukeboxProvider({ roomId, children }: { roomId?: string; children: ReactNode }) {
  const [view, setView] = useState(() => emptyJukeboxView(Boolean(roomId)));
  const sync = useRef<ReturnType<typeof startJukeboxSync> | null>(null);
  useEffect(() => {
    if (!roomId) return;
    const current = startJukeboxSync(jukeboxAccess(supabase, roomId), setView, { window, document });
    sync.current = current;
    // Defer reads outside the auth callback to avoid locking Auth internals.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { current.leave(); return; }
      queueMicrotask(() => { void current.refresh(); });
    });
    return () => {
      sync.current = null;
      current.dispose();
      subscription.unsubscribe();
    };
  }, [roomId]);
  const refresh = useCallback(async () => { await sync.current?.refresh(); }, []);
  const control = useCallback(async (command: JukeboxCommand) => { await sync.current?.control(command); }, []);
  return <RoomJukeboxContext.Provider value={{ ...view, refresh, control }}>{children}</RoomJukeboxContext.Provider>;
}

export function useRoomJukebox() {
  const value = useContext(RoomJukeboxContext);
  if (!value) throw new Error("useRoomJukebox must be used inside RoomJukeboxProvider");
  return value;
}
