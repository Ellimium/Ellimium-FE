"use client";

import { FunctionsHttpError } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { emptyJukeboxAudio, startJukeboxAudio, type JukeboxAudioView } from "./jukebox-audio";
import { emptyJukeboxView, jukeboxAccess, startJukeboxSync, type JukeboxCommand, type JukeboxView } from "./jukebox";

type ContextValue = JukeboxView & {
  audio: JukeboxAudioView;
  activateAudio: () => void;
  retryAudio: () => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  refresh: () => Promise<void>;
  control: (command: JukeboxCommand) => Promise<void>;
};
const RoomJukeboxContext = createContext<ContextValue | null>(null);

export function RoomJukeboxProvider({ roomId, children }: { roomId?: string; children: ReactNode }) {
  const [view, setView] = useState(() => emptyJukeboxView(Boolean(roomId)));
  const [audioView, setAudioView] = useState(emptyJukeboxAudio);
  const audio = useRef<ReturnType<typeof startJukeboxAudio> | null>(null);
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
  useEffect(() => {
    if (!roomId) return;
    const element = new Audio();
    element.preload = "metadata";
    const current = startJukeboxAudio(element, async (musicId) => {
      const { data, error } = await supabase.functions.invoke("music-signed-url", { body: { musicAssetId: musicId } });
      if (error) {
        const status = error instanceof FunctionsHttpError && error.context instanceof Response ? error.context.status : undefined;
        throw Object.assign(new Error(status === 401 || status === 403
          ? "음악 접근 권한이 없거나 삭제된 음악입니다. 재생을 종료했습니다."
          : "음악 URL을 발급받지 못했습니다. 다시 시도하세요."), { accessDenied: status === 401 || status === 403 });
      }
      return data;
    }, setAudioView, () => { void sync.current?.refresh(); });
    audio.current = current;
    return () => { audio.current = null; current.dispose(); };
  }, [roomId]);
  useEffect(() => { audio.current?.update(view.role ? view.state : null); }, [view.role, view.state]);
  const activateAudio = useCallback(() => { audio.current?.activate(); }, []);
  const retryAudio = useCallback(() => { audio.current?.retry(); }, []);
  const setVolume = useCallback((value: number) => { audio.current?.setVolume(value); }, []);
  const setMuted = useCallback((value: boolean) => { audio.current?.setMuted(value); }, []);
  const refresh = useCallback(async () => { await sync.current?.refresh(); }, []);
  const control = useCallback(async (command: JukeboxCommand) => { await sync.current?.control(command); }, []);
  return <RoomJukeboxContext.Provider value={{ ...view, audio: audioView, activateAudio, retryAudio, setVolume, setMuted, refresh, control }}>{children}</RoomJukeboxContext.Provider>;
}

export function useRoomJukebox() {
  const value = useContext(RoomJukeboxContext);
  if (!value) throw new Error("useRoomJukebox must be used inside RoomJukeboxProvider");
  return value;
}
