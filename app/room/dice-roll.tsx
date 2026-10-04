"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { diceErrorMessage } from "./dice-error";
import { diceRollDisplay, mergeDiceRolls, visibleDiceRolls } from "./dice-log";
import type { DiceRollLog, DiceSort, DiceVisibility } from "./dice-log";
import { supabase } from "@/lib/supabase/client";
import { useRoomPermissions } from "./room-permissions";

type Role = "master" | "player" | "spectator";
type Member = { user_id: string; role: Role };
type Profile = { user_id: string; nickname: string };

const dateTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" });
const ROLL_FIELDS = "id, room_id, roller_id, expression, individual_results, total, visibility, created_at";
const NOTIFICATION_FIELDS = "id, room_id, roller_id, visibility, created_at";

export default function DiceRoll({ roomId }: { roomId?: string }) {
  const { canUse, loading: permissionLoading } = useRoomPermissions();
  const [role, setRole] = useState<Role | null>(null);
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

    if (!roomId) {
      setLoading(false);
      return;
    }

    async function load() {
      setRole(null);
      setRolls([]);
      setRollerNames({});
      setLoading(true);
      setError("");
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      if (!user) {
        setError("주사위 권한을 확인할 수 없습니다.");
        setLoading(false);
        return;
      }

      const [memberResult, rollResult, notificationResult] = await Promise.all([
        supabase.from("room_members").select("user_id, role").eq("room_id", roomId).eq("status", "active").order("joined_at"),
        supabase.from("dice_rolls").select(ROLL_FIELDS).eq("room_id", roomId).order("created_at", { ascending: false }),
        supabase.from("dice_roll_notifications").select(NOTIFICATION_FIELDS).eq("room_id", roomId).order("created_at", { ascending: false }),
      ]);

      if (!active) return;
      if (memberResult.error || rollResult.error || notificationResult.error) {
        setError("주사위 기록을 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      const nextRolls = mergeDiceRolls(
        (notificationResult.data ?? []) as DiceRollLog[],
        (rollResult.data ?? []) as DiceRollLog[],
      );
      const members = (memberResult.data ?? []) as Member[];
      const rollerIds = [...new Set([user.id, ...members.map((member) => member.user_id), ...nextRolls.map((roll) => roll.roller_id)])];
      const { data: profileData, error: profileError } = await supabase.from("profiles").select("user_id, nickname").in("user_id", rollerIds);
      if (!active) return;
      if (profileError) {
        setError("주사위 기록의 사용자 정보를 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      setRole(members.find((member) => member.user_id === user.id)?.role ?? null);
      setRolls((current) => mergeDiceRolls(current, nextRolls));
      setRollerNames(Object.fromEntries(((profileData ?? []) as Profile[]).map((profile) => [profile.user_id, profile.nickname])));
      setLoading(false);
    }

    void load();
    return () => { active = false; };
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;

    const channel = supabase
      .channel(`room:${roomId}:dice`, { config: { private: true } })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "dice_rolls",
        filter: `room_id=eq.${roomId}`,
      }, ({ new: inserted }) => {
        const roll = inserted as DiceRollLog;
        if (roll.id && roll.room_id === roomId) setRolls((current) => mergeDiceRolls(current, roll));
      })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "dice_roll_notifications",
        filter: `room_id=eq.${roomId}`,
      }, ({ new: inserted }) => {
        const roll = inserted as DiceRollLog;
        if (roll.id && roll.room_id === roomId) setRolls((current) => mergeDiceRolls(current, roll));
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setError("주사위 실시간 채널에 연결하지 못했습니다.");
      });

    return () => { void supabase.removeChannel(channel); };
  }, [roomId]);

  const canRoll = Boolean(role) && !permissionLoading && canUse("dice");
  const rollers = useMemo(() => [...new Set(rolls.map((roll) => roll.roller_id))].map((id) => ({ id, name: rollerNames[id] ?? "알 수 없는 사용자" })), [rolls, rollerNames]);
  const visibleRolls = useMemo(() => visibleDiceRolls(rolls, rollerNames, rollerFilter, visibilityFilter, search, sort), [rolls, rollerNames, rollerFilter, visibilityFilter, search, sort]);

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
