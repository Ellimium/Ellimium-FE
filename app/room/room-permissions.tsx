"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import { startRoomMembershipSync, type RoomMember } from "./room-membership";
import {
  resolveRoomFeatureState,
  type ConfigurableRole,
  type RoomFeature,
  type RoomFeaturePermission,
  type RoomFeatureState,
  type RoomRole,
} from "./room-permission";

type RoomPermissionsContextValue = {
  currentUserId: string | null;
  role: RoomRole | null;
  permissions: RoomFeatureState;
  rows: RoomFeaturePermission[];
  loading: boolean;
  checking: boolean;
  members: RoomMember[];
  refreshMembership: () => Promise<void>;
  error: string;
  pendingKey: string;
  canUse: (feature: RoomFeature) => boolean;
  setRolePermission: (role: ConfigurableRole, feature: RoomFeature, allowed: boolean) => Promise<void>;
};

const RoomPermissionsContext = createContext<RoomPermissionsContextValue | null>(null);

export function RoomPermissionsProvider({ roomId, children }: { roomId?: string; children: ReactNode }) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [role, setRole] = useState<RoomRole | null>(null);
  const [rows, setRows] = useState<RoomFeaturePermission[]>([]);
  const [loading, setLoading] = useState(Boolean(roomId));
  const [checking, setChecking] = useState(Boolean(roomId));
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [refreshMembership, setRefreshMembership] = useState<() => Promise<void>>(() => async () => {});
  const [error, setError] = useState("");
  const [pendingKey, setPendingKey] = useState("");

  useEffect(() => {
    if (!roomId) {
      setCurrentUserId(null);
      setRole(null);
      setRows([]);
      setMembers([]);
      setLoading(false);
      setChecking(false);
      setError("");
      setRefreshMembership(() => async () => {});
      return;
    }

    setLoading(true);
    const sync = startRoomMembershipSync(supabase, roomId, (view) => {
      setChecking(view.checking);
      if (view.checking) return;
      setCurrentUserId(view.userId);
      setRole(view.role);
      setRows(view.rows);
      setMembers((current) => JSON.stringify(current) === JSON.stringify(view.members) ? current : view.members);
      setError(view.error);
      setLoading(false);
    }, { window, document });
    setRefreshMembership(() => sync.refresh);
    return sync.dispose;
  }, [roomId]);

  const permissions = useMemo(
    () => resolveRoomFeatureState(loading || error ? null : role, currentUserId, rows, checking),
    [checking, currentUserId, error, loading, role, rows],
  );
  const canUse = useCallback((feature: RoomFeature) => permissions[feature], [permissions]);

  const setRolePermission = useCallback(async (targetRole: ConfigurableRole, feature: RoomFeature, allowed: boolean) => {
    if (!roomId || role !== "master" || loading || checking || error) return;

    const key = `${targetRole}:${feature}`;
    setPendingKey(key);
    setError("");
    try {
      const { error: updateError } = await supabase.rpc("set_room_feature_permission", {
        target_room_id: roomId,
        target_feature: feature,
        new_allowed: allowed,
        target_role: targetRole,
        target_user_id: null,
      });

      if (updateError) {
        setError(updateError.code === "42501" ? "마스터만 기능 권한을 변경할 수 있습니다." : "기능 권한을 저장하지 못했습니다.");
      } else {
        setRows((current) => current.map((row) =>
          row.role === targetRole && row.feature === feature ? { ...row, allowed } : row));
      }
    } catch {
      setError("기능 권한 서버에 연결하지 못했습니다.");
    } finally {
      setPendingKey("");
    }
  }, [checking, error, loading, role, roomId]);

  const value = useMemo(() => ({
    currentUserId,
    role,
    permissions,
    rows,
    loading,
    checking,
    members,
    refreshMembership,
    error,
    pendingKey,
    canUse,
    setRolePermission,
  }), [canUse, checking, currentUserId, error, loading, members, pendingKey, permissions, refreshMembership, role, rows, setRolePermission]);

  return <RoomPermissionsContext.Provider value={value}>{children}</RoomPermissionsContext.Provider>;
}

export function useRoomPermissions() {
  const context = useContext(RoomPermissionsContext);
  if (!context) throw new Error("useRoomPermissions must be used inside RoomPermissionsProvider");
  return context;
}
