"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { roomRecordState, type RecordConnectionState } from "./record-connection";

type Feature = "chat" | "dice";
type Connection = { state: RecordConnectionState; retry: () => void };
const initial: Connection = { state: "connecting", retry: () => {} };
const RoomConnectionContext = createContext<{
  records: Record<Feature, Connection>;
  publish: (feature: Feature, state: RecordConnectionState, retry: () => void) => void;
} | null>(null);

export function RoomConnectionProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState({ chat: initial, dice: initial });
  const publish = useCallback((feature: Feature, state: RecordConnectionState, retry: () => void) => {
    setRecords((current) => current[feature].state === state && current[feature].retry === retry
      ? current : { ...current, [feature]: { state, retry } });
  }, []);
  const value = useMemo(() => ({ records, publish }), [records, publish]);
  return <RoomConnectionContext.Provider value={value}>{children}</RoomConnectionContext.Provider>;
}
function useConnections() {
  const context = useContext(RoomConnectionContext);
  if (!context) throw new Error("RoomConnectionProvider is required");
  return context;
}
export function useRecordConnection(feature: Feature) {
  const { records, publish } = useConnections();
  const update = useCallback((state: RecordConnectionState, retry: () => void) => publish(feature, state, retry), [feature, publish]);
  return { ...records[feature], publish: update };
}
export function useRoomConnection() {
  const { records } = useConnections();
  return { state: roomRecordState([records.chat.state, records.dice.state]), retry: () => {
    for (const record of Object.values(records)) if (record.state === "error" || record.state === "disconnected") record.retry();
  } };
}
