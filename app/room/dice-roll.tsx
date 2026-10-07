"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { diceErrorMessage } from "./dice-error";
import { diceRollDisplay, mergeDiceRolls, visibleDiceRolls } from "./dice-log";
import type { DiceRollLog, DiceSort, DiceVisibility } from "./dice-log";
import { supabase } from "@/lib/supabase/client";
import { useRoomPermissions } from "./room-permissions";

type Profile = { user_id: string; nickname: string };

const dateTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" });
const ROLL_FIELDS = "id, room_id, roller_id, expression, individual_results, total, visibility, character_sheet_id, sheet_roll, created_at";
const NOTIFICATION_FIELDS = "id, room_id, roller_id, visibility, created_at";

export default function DiceRoll({ roomId }: { roomId?: string }) {
  const { role, currentUserId, members, canUse, loading: permissionLoading } = useRoomPermissions();
  const [loadedRole, setLoadedRole] = useState<typeof role>(null);
  const [rolls, setRolls] = useState<DiceRollLog[]>([]);
  const [rollerNames, setRollerNames] = useState<Record<string, string>>({});
  const [rollerFilter, setRollerFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<"" | DiceVisibility>("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<DiceSort>("desc");
  const [expression, setExpression] = useState("");
  const [visibility, setVisibility] = useState<DiceVisibility>("public");
  const [loading, setLoading] = useState(Boolean(roomId));
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let version = 0;
    setLoadedRole(null);
    setRolls([]);
    setRollerNames({});

    if (!roomId || !role || !currentUserId || permissionLoading) {
      setLoading(false);
      return;
    }

    setLoading(true);

    async function loadRecords(table: "dice_rolls" | "dice_roll_notifications", request: number) {
      const records: DiceRollLog[] = [];
      for (let offset = 0; ; offset += 1000) {
        const query = table === "dice_rolls"
          ? supabase.from(table).select(ROLL_FIELDS)
          : supabase.from(table).select(NOTIFICATION_FIELDS);
        const result = await query.eq("room_id", roomId).order("created_at").order("id").range(offset, offset + 999);
        if (!active || request !== version) return { data: [], error: null };
        if (result.error) return result;
        const page = (result.data ?? []) as DiceRollLog[];
        records.push(...page);
        if (page.length < 1000) return { data: records, error: null };
      }
    }

    async function load() {
      const request = ++version;
      setError("");
      try {
        const [rollResult, notificationResult] = await Promise.all([
          loadRecords("dice_rolls", request),
          loadRecords("dice_roll_notifications", request),
        ]);

        if (!active || request !== version) return;
        if (rollResult.error || notificationResult.error) {
          setError("주사위 기록을 불러오지 못했습니다.");
          setLoading(false);
          return;
        }

        const nextRolls = mergeDiceRolls(
          (notificationResult.data ?? []) as DiceRollLog[],
          (rollResult.data ?? []) as DiceRollLog[],
        );
        const rollerIds = [...new Set([currentUserId, ...members.map((member) => member.user_id), ...nextRolls.map((roll) => roll.roller_id)])];
        const { data: profileData, error: profileError } = await supabase.from("profiles").select("user_id, nickname").in("user_id", rollerIds);
        if (!active || request !== version) return;
        if (profileError) {
          setError("주사위 기록의 사용자 정보를 불러오지 못했습니다.");
          setLoading(false);
          return;
        }

        setLoadedRole(role);
        setRolls((current) => mergeDiceRolls(current, nextRolls));
        setRollerNames(Object.fromEntries(((profileData ?? []) as Profile[]).map((profile) => [profile.user_id, profile.nickname])));
        setLoading(false);
      } catch {
        if (active && request === version) {
          setError("주사위 서버에 연결하지 못했습니다.");
          setLoading(false);
        }
      }
    }

    const channel = supabase
      .channel(`room:${roomId}:dice`, { config: { private: true } })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "dice_rolls",
        filter: `room_id=eq.${roomId}`,
      }, ({ new: inserted }) => {
        if (!active) return;
        const roll = inserted as DiceRollLog;
        if (roll.id && roll.room_id === roomId) setRolls((current) => mergeDiceRolls(current, roll));
      })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "dice_roll_notifications",
        filter: `room_id=eq.${roomId}`,
      }, ({ new: inserted }) => {
        if (!active) return;
        const roll = inserted as DiceRollLog;
        if (roll.id && roll.room_id === roomId) setRolls((current) => mergeDiceRolls(current, roll));
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") void load();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setError("주사위 실시간 채널에 연결하지 못했습니다.");
      });

    void load();
    return () => {
      active = false;
      version++;
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, members, permissionLoading, role, roomId]);

  const canRoll = Boolean(role) && !loading && loadedRole === role && !permissionLoading && canUse("dice");
  const rollers = useMemo(() => [...new Set(rolls.map((roll) => roll.roller_id))].map((id) => ({ id, name: rollerNames[id] ?? "알 수 없는 사용자" })), [rolls, rollerNames]);
  const visibleRolls = useMemo(() => visibleDiceRolls(loadedRole === role ? rolls : [], rollerNames, rollerFilter, visibilityFilter, search, sort), [loadedRole, role, rolls, rollerNames, rollerFilter, visibilityFilter, search, sort]);

  async function roll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomId || !canRoll || !expression.trim()) return;

    setRolling(true);
    setError("");
    try {
      const { data, error: rollError } = await supabase.rpc("roll_dice", {
        target_room_id: roomId,
        dice_expression: expression.trim(),
        roll_visibility: visibility,
      });
      if (rollError) {
        setError(diceErrorMessage(rollError));
        return;
      }

      const result = (Array.isArray(data) ? data[0] : data) as DiceRollLog | null;
      if (!result?.id) {
        setError("주사위 요청을 처리하지 못했습니다.");
        return;
      }
      setRolls((current) => [result, ...current.filter((currentRoll) => currentRoll.id !== result.id)]);
      setExpression("");
    } catch {
      setError("주사위 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setRolling(false);
    }
  }

  return <section className="chat-panel dice-panel" aria-label="주사위" aria-busy={loading || rolling}>
    <div className="panel-tabs"><button className="active" type="button">주사위</button><span>기록</span></div>
    <div className="dice-log-tools">
      <input type="search" aria-label="주사위 로그 검색" placeholder="로그 검색" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select aria-label="주사위 사용자 필터" value={rollerFilter} onChange={(event) => setRollerFilter(event.target.value)}>
        <option value="">전체 사용자</option>
        {rollers.map((roller) => <option key={roller.id} value={roller.id}>{roller.name}</option>)}
      </select>
      <select aria-label="주사위 공개 상태 필터" value={visibilityFilter} onChange={(event) => setVisibilityFilter(event.target.value as "" | DiceVisibility)}>
        <option value="">전체 공개 상태</option><option value="public">공개</option><option value="private">비공개</option>
      </select>
      <select aria-label="주사위 시간순 정렬" value={sort} onChange={(event) => setSort(event.target.value as DiceSort)}>
        <option value="desc">최신순</option><option value="asc">오래된순</option>
      </select>
    </div>
    <div className="messages dice-list" role="log" aria-live="polite" aria-relevant="additions">
      {loading && <p className="system-message">주사위 기록을 불러오는 중…</p>}
      {!loading && !rolls.length && <p className="system-message">아직 주사위 기록이 없습니다.</p>}
      {!loading && rolls.length > 0 && !visibleRolls.length && <p className="system-message">조건에 맞는 주사위 기록이 없습니다.</p>}
      {visibleRolls.map((roll) => {
        const display = diceRollDisplay(roll);
        return <div className={`dice-message dice-message-${roll.visibility}`} key={roll.id}>
          <span className="dice-author">{rollerNames[roll.roller_id] ?? "알 수 없는 사용자"}<time dateTime={roll.created_at}>{dateTime.format(new Date(roll.created_at))}</time></span>
          <strong>{display.total}</strong><span>{display.summary}</span><small>{display.results}</small>
        </div>;
      })}
    </div>
    {error && <p className="form-error dice-error" role="alert">{error}</p>}
    {!permissionLoading && role && !canRoll && <p className="dice-notice">주사위 결과는 볼 수 있지만 굴림 권한이 없습니다.</p>}
    <form className="chat-input dice-input" onSubmit={roll}>
      <select aria-label="주사위 공개 범위" value={visibility} onChange={(event) => setVisibility(event.target.value as DiceVisibility)} disabled={!canRoll || loading || rolling}>
        <option value="public">공개</option><option value="private">비공개</option>
      </select>
      <input aria-label="주사위 표현식" value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="/roll 1d20" required disabled={!canRoll || loading || rolling} />
      <button type="submit" aria-label="주사위 굴리기" disabled={!canRoll || loading || rolling}>{rolling ? "…" : "↑"}</button>
    </form>
  </section>;
}
