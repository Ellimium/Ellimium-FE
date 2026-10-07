"use client";

import {
  CONFIGURABLE_ROLE_NAMES,
  ROOM_FEATURE_NAMES,
  ROOM_FEATURES,
  type ConfigurableRole,
} from "./room-permission";
import { useRoomPermissions } from "./room-permissions";

const CONFIGURABLE_ROLES = Object.keys(CONFIGURABLE_ROLE_NAMES) as ConfigurableRole[];

export default function RoomFeaturePermissions() {
  const { role, rows, loading, checking, error, pendingKey, setRolePermission } = useRoomPermissions();
  if (role !== "master") return null;

  return <section className="room-feature-permissions" aria-label="룸 기능 권한 설정">
    <details>
      <summary><span><small>PERMISSIONS</small>기능 권한</span><em>{loading || checking ? "확인 중" : "역할별 설정"}</em></summary>
      <div className="permission-role-list">
        {CONFIGURABLE_ROLES.map((targetRole) => <fieldset key={targetRole} disabled={loading || checking || Boolean(error)}>
          <legend>{CONFIGURABLE_ROLE_NAMES[targetRole]}</legend>
          {ROOM_FEATURES.map((feature) => {
            const key = `${targetRole}:${feature}`;
            const checked = rows.find((row) => row.role === targetRole && row.feature === feature)?.allowed ?? false;
            return <label key={feature}>
              <input
                type="checkbox"
                checked={checked}
                disabled={Boolean(pendingKey)}
                onChange={(event) => { void setRolePermission(targetRole, feature, event.target.checked); }}
              />
              <span>{ROOM_FEATURE_NAMES[feature]}</span>
              {pendingKey === key && <small>저장 중…</small>}
            </label>;
          })}
        </fieldset>)}
      </div>
      <p className="permission-help">변경 사항은 해당 역할 참가자의 기능 상태에 즉시 반영됩니다.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </details>
  </section>;
}
