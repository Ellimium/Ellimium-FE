"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import {
  isRoomFeaturePermission,
  mergeRoomFeaturePermission,
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
  error: string;
  pendingKey: string;
  canUse: (feature: RoomFeature) => boolean;
  setRolePermission: (role: ConfigurableRole, feature: RoomFeature, allowed: boolean) => Promise<void>;
};

const RoomPermissionsContext = createContext<RoomPermissionsContextValue | null>(null);
const PERMISSION_FIELDS = "id, room_id, feature, role, user_id, allowed";

export function RoomPermissionsProvider({ roomId, children }: { roomId?: string; children: ReactNode }) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [role, setRole] = useState<RoomRole | null>(null);
  const [rows, setRows] = useState<RoomFeaturePermission[]>([]);
  const [loading, setLoading] = useState(Boolean(roomId));
  const [error, setError] = useState("");
  const [pendingKey, setPendingKey] = useState("");

  useEffect(() => {
    let active = true;

    if (!roomId) {
      setCurrentUserId(null);
      setRole(null);
      setRows([]);
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError("");

      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      if (!user) {
        setError("룸 기능 권한을 확인할 수 없습니다.");
        setLoading(false);
        return;
      }

      const [memberResult, permissionResult] = await Promise.all([
        supabase.from("room_members").select("role").eq("room_id", roomId).eq("user_id", user.id).eq("status", "active").maybeSingle(),
        supabase.from("room_feature_permissions").select(PERMISSION_FIELDS).eq("room_id", roomId),
      ]);

      if (!active) return;
      if (memberResult.error || permissionResult.error) {
        setError("룸 기능 권한을 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      setCurrentUserId(user.id);
      setRole((memberResult.data?.role as RoomRole | undefined) ?? null);
      setRows((permissionResult.data ?? []).filter(isRoomFeaturePermission));
      setLoading(false);
    }

    void load();
    return () => { active = false; };
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;

    const channel = supabase
      .channel(`room:${roomId}:feature-permissions`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "room_feature_permissions",
        filter: `room_id=eq.${roomId}`,
      }, ({ new: changed }) => {
        if (isRoomFeaturePermission(changed)) {
          setRows((current) => mergeRoomFeaturePermission(current, changed));
        }
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError("기능 권한 실시간 변경을 받을 수 없습니다.");
        }
      });

    return () => { void supabase.removeChannel(channel); };
  }, [roomId]);

  const permissions = useMemo(
    () => resolveRoomFeatureState(role, currentUserId, rows),
    [currentUserId, role, rows],
  );
  const canUse = useCallback((feature: RoomFeature) => permissions[feature], [permissions]);

  const setRolePermission = useCallback(async (targetRole: ConfigurableRole, feature: RoomFeature, allowed: boolean) => {
    if (!roomId || role !== "master") return;

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
  }, [role, roomId]);

  const value = useMemo(() => ({
    currentUserId,
    role,
    permissions,
    rows,
    loading,
    error,
    pendingKey,
    canUse,
    setRolePermission,
  }), [canUse, currentUserId, error, loading, pendingKey, permissions, role, rows, setRolePermission]);

  return <RoomPermissionsContext.Provider value={value}>{children}</RoomPermissionsContext.Provider>;
}

export function useRoomPermissions() {
  const context = useContext(RoomPermissionsContext);
  if (!context) throw new Error("useRoomPermissions must be used inside RoomPermissionsProvider");
  return context;
}
