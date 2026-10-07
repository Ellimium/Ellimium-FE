export const ROOM_FEATURES = ["chat", "map_view", "dice", "token_move", "drawing"] as const;

export type RoomFeature = typeof ROOM_FEATURES[number];
export type RoomRole = "master" | "player" | "spectator";
export type ConfigurableRole = Exclude<RoomRole, "master">;

export type RoomFeaturePermission = {
  id: string;
  room_id: string;
  feature: RoomFeature;
  role: ConfigurableRole | null;
  user_id: string | null;
  allowed: boolean;
};

export type RoomFeatureState = Record<RoomFeature, boolean>;

export const ROOM_FEATURE_NAMES: Record<RoomFeature, string> = {
  chat: "채팅",
  map_view: "맵 보기",
  dice: "주사위",
  token_move: "토큰 이동",
  drawing: "그리기",
};

export const CONFIGURABLE_ROLE_NAMES: Record<ConfigurableRole, string> = {
  player: "플레이어",
  spectator: "관전자",
};

const deniedPermissions = () => Object.fromEntries(
  ROOM_FEATURES.map((feature) => [feature, false]),
) as RoomFeatureState;

export function resolveRoomFeatureState(
  role: RoomRole | null,
  userId: string | null,
  rows: RoomFeaturePermission[],
  checking = false,
): RoomFeatureState {
  if (role === "master" && !checking) {
    return Object.fromEntries(ROOM_FEATURES.map((feature) => [feature, true])) as RoomFeatureState;
  }

  if (!role || !userId) return deniedPermissions();

  const state = deniedPermissions();
  for (const feature of ROOM_FEATURES) {
    const participant = rows.find((row) => row.feature === feature && row.user_id === userId);
    const roleDefault = rows.find((row) => row.feature === feature && row.role === role);
    // Keep read-only map visibility stable while writes wait for a fresh membership check.
    state[feature] = (!checking || feature === "map_view")
      && (role === "master" || (participant?.allowed ?? roleDefault?.allowed ?? false));
  }
  return state;
}

export function mergeRoomFeaturePermission(
  rows: RoomFeaturePermission[],
  incoming: RoomFeaturePermission,
) {
  const index = rows.findIndex((row) => row.id === incoming.id);
  if (index < 0) return [...rows, incoming];
  return rows.map((row, rowIndex) => rowIndex === index ? incoming : row);
}

export function isRoomFeaturePermission(value: unknown): value is RoomFeaturePermission {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<RoomFeaturePermission>;
  return typeof row.id === "string"
    && typeof row.room_id === "string"
    && ROOM_FEATURES.includes(row.feature as RoomFeature)
    && (row.role === null || row.role === "player" || row.role === "spectator")
    && (row.user_id === null || typeof row.user_id === "string")
    && typeof row.allowed === "boolean";
}
