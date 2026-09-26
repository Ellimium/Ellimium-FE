"use client";

import { FormEvent, useEffect, useState } from "react";

import { diceErrorMessage } from "./dice-error";
import { supabase } from "@/lib/supabase/client";

type Role = "master" | "player" | "spectator";
type DiceRoll = {
  id: string;
  roller_id: string;
  expression: string;
  individual_results: unknown;
  total: number | string;
  created_at: string;
};

function resultsText(results: unknown) {
  return Array.isArray(results) ? results.join(" + ") : String(results);
}

export default function DiceRoll({ roomId }: { roomId?: string }) {
  const [role, setRole] = useState<Role | null>(null);
  const [rolls, setRolls] = useState<DiceRoll[]>([]);
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
      } else {
        setRole((member?.role as Role | undefined) ?? null);
        setRolls((rollData ?? []) as DiceRoll[]);
      }
      setLoading(false);
    }

    void load();
    return () => { active = false; };
  }, [roomId]);

  const canRoll = role === "master" || role === "player";

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

      const result = (Array.isArray(data) ? data[0] : data) as DiceRoll | null;
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
    <div className="messages dice-list">
      {loading && <p className="system-message">주사위 기록을 불러오는 중…</p>}
      {!loading && !rolls.length && <p className="system-message">아직 주사위 기록이 없습니다.</p>}
      {rolls.map((roll) => <div className="dice-message" key={roll.id}>
        <span>{roll.expression}</span><strong>{roll.total}</strong><small>{resultsText(roll.individual_results)}</small>
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
