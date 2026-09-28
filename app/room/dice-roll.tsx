"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { diceErrorMessage } from "./dice-error";
import { resultsText, visibleDiceRolls } from "./dice-log";
import type { DiceRollLog, DiceSort } from "./dice-log";
import { supabase } from "@/lib/supabase/client";

type Role = "master" | "player" | "spectator";
type Profile = { user_id: string; nickname: string };

const dateTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" });

export default function DiceRoll({ roomId }: { roomId?: string }) {
  const [role, setRole] = useState<Role | null>(null);
  const [rolls, setRolls] = useState<DiceRollLog[]>([]);
  const [rollerNames, setRollerNames] = useState<Record<string, string>>({});
  const [rollerFilter, setRollerFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<DiceSort>("desc");
  const [expression, setExpression] = useState("");
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
      setLoading(true);
      setError("");
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      if (!user) {
        setError("주사위 권한을 확인할 수 없습니다.");
        setLoading(false);
        return;
      }

      const [{ data: member, error: memberError }, { data: rollData, error: rollError }] = await Promise.all([
        supabase.from("room_members").select("role").eq("room_id", roomId).eq("user_id", user.id).eq("status", "active").maybeSingle(),
        supabase.from("dice_rolls").select("id, roller_id, expression, individual_results, total, created_at").eq("room_id", roomId).order("created_at", { ascending: false }),
      ]);

      if (!active) return;
      if (memberError || rollError) {
        setError("주사위 기록을 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      const nextRolls = (rollData ?? []) as DiceRollLog[];
      const rollerIds = [...new Set([user.id, ...nextRolls.map((roll) => roll.roller_id)])];
      const { data: profileData, error: profileError } = await supabase.from("profiles").select("user_id, nickname").in("user_id", rollerIds);
      if (!active) return;
      if (profileError) {
        setError("주사위 기록의 사용자 정보를 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      setRole((member?.role as Role | undefined) ?? null);
      setRolls(nextRolls);
      setRollerNames(Object.fromEntries(((profileData ?? []) as Profile[]).map((profile) => [profile.user_id, profile.nickname])));
      setLoading(false);
    }

    void load();
    return () => { active = false; };
  }, [roomId]);

  const canRoll = role === "master" || role === "player";
  const rollers = useMemo(() => [...new Set(rolls.map((roll) => roll.roller_id))].map((id) => ({ id, name: rollerNames[id] ?? "알 수 없는 사용자" })), [rolls, rollerNames]);
  const visibleRolls = useMemo(() => visibleDiceRolls(rolls, rollerNames, rollerFilter, search, sort), [rolls, rollerNames, rollerFilter, search, sort]);

  async function roll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomId || !canRoll || !expression.trim()) return;

    setRolling(true);
    setError("");
    try {
      const { data, error: rollError } = await supabase.rpc("roll_dice", {
        target_room_id: roomId,
        dice_expression: expression.trim(),
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
      <select aria-label="주사위 시간순 정렬" value={sort} onChange={(event) => setSort(event.target.value as DiceSort)}>
        <option value="desc">최신순</option><option value="asc">오래된순</option>
      </select>
    </div>
    <div className="messages dice-list">
      {loading && <p className="system-message">주사위 기록을 불러오는 중…</p>}
      {!loading && !rolls.length && <p className="system-message">아직 주사위 기록이 없습니다.</p>}
      {!loading && rolls.length > 0 && !visibleRolls.length && <p className="system-message">조건에 맞는 주사위 기록이 없습니다.</p>}
      {visibleRolls.map((roll) => <div className="dice-message" key={roll.id}>
        <span className="dice-author">{rollerNames[roll.roller_id] ?? "알 수 없는 사용자"}<time dateTime={roll.created_at}>{dateTime.format(new Date(roll.created_at))}</time></span>
        <strong>{roll.total}</strong><span>{roll.expression}</span><small>{resultsText(roll.individual_results)}</small>
      </div>)}
    </div>
    {error && <p className="form-error dice-error" role="alert">{error}</p>}
    {role === "spectator" && <p className="dice-notice">관전자는 주사위 결과만 볼 수 있습니다.</p>}
    <form className="chat-input" onSubmit={roll}>
      <input aria-label="주사위 표현식" value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="/roll 1d20" required disabled={!canRoll || loading || rolling} />
      <button type="submit" aria-label="주사위 굴리기" disabled={!canRoll || loading || rolling}>{rolling ? "…" : "↑"}</button>
    </form>
  </section>;
}
