"use client";

import { FormEvent, useEffect, useState } from "react";

import { buildAttributes, SHEET_SYSTEMS } from "./character-sheet";
import type { SheetSystem } from "./character-sheet";
import { supabase } from "@/lib/supabase/client";

type Role = "master" | "player" | "spectator";
type CharacterSheet = {
  id: string;
  name: string;
  system: SheetSystem;
  attributes: Record<string, unknown>;
};

export default function CharacterSheets({ roomId }: { roomId?: string }) {
  const [role, setRole] = useState<Role | null>(null);
  const [userId, setUserId] = useState("");
  const [sheets, setSheets] = useState<CharacterSheet[]>([]);
  const [system, setSystem] = useState<SheetSystem>("dnd_5e");
  const [loading, setLoading] = useState(Boolean(roomId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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
        setError("캐릭터 시트 권한을 확인할 수 없습니다.");
        setLoading(false);
        return;
      }

      const [{ data: member, error: memberError }, { data: sheetData, error: sheetError }] = await Promise.all([
        supabase.from("room_members").select("role").eq("room_id", roomId).eq("user_id", user.id).eq("status", "active").maybeSingle(),
        supabase.from("character_sheets").select("id, name, system, attributes").eq("room_id", roomId).order("created_at"),
      ]);
      if (!active) return;
      if (memberError || sheetError) {
        setError("캐릭터 시트를 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      setUserId(user.id);
      setRole((member?.role as Role | undefined) ?? null);
      setSheets((sheetData ?? []) as CharacterSheet[]);
      setLoading(false);
    }

    void load();
    return () => { active = false; };
  }, [roomId]);

  async function createSheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomId || !userId || role !== "player") return;

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") ?? "").trim();
    const values = Object.fromEntries(SHEET_SYSTEMS[system].fields.map((field) => [field, String(form.get(field) ?? "")]));

    setError("");
    setMessage("");
    if (!name) {
      setError("캐릭터 이름을 입력하세요.");
      return;
    }

    let attributes: Record<string, string | number>;
    try {
      attributes = buildAttributes(system, values, String(form.get("customAttributes") ?? ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "능력치를 확인하세요.");
      return;
    }

    setSaving(true);
    try {
      const { data, error: insertError } = await supabase.from("character_sheets").insert({
        room_id: roomId,
        owner_id: userId,
        name,
        system,
        attributes,
      }).select("id, name, system, attributes").single();

      if (insertError || !data) {
        setError("캐릭터 시트를 생성하지 못했습니다. 룸과 플레이어 권한을 확인하세요.");
        return;
      }
      setSheets((current) => [...current, data as CharacterSheet]);
      formElement.reset();
      setSystem("dnd_5e");
      setMessage("캐릭터 시트를 생성했습니다.");
    } catch {
      setError("캐릭터 시트 서버에 연결하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!roomId) return null;

  return <section className="character-sheets" aria-label="캐릭터 시트" aria-busy={loading || saving}>
    <div className="panel-heading"><div><p className="eyebrow">CHARACTER</p><h2>캐릭터 시트</h2></div><span>{loading ? "불러오는 중" : `${sheets.length}개`}</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-message" role="status">{message}</p>}
    {!loading && role === "player" && <details className="character-sheet-create">
      <summary>새 시트 만들기</summary>
      <form onSubmit={createSheet}>
        <label>캐릭터 이름<input name="name" required maxLength={50} disabled={saving} /></label>
        <label>템플릿<select value={system} disabled={saving} onChange={(event) => setSystem(event.target.value as SheetSystem)}>{Object.entries(SHEET_SYSTEMS).map(([value, template]) => <option key={value} value={value}>{template.label}</option>)}</select></label>
        {system === "custom" ? <label>사용자 정의 항목<textarea name="customAttributes" required rows={3} placeholder={"행운=50\n직업=탐정"} disabled={saving} /></label> : <div className="character-attributes">{SHEET_SYSTEMS[system].fields.map((field) => <label key={field}>{field}<input name={field} type="number" required disabled={saving} /></label>)}</div>}
        <button className="primary-button" type="submit" disabled={saving}>{saving ? "생성 중…" : "시트 생성"}</button>
      </form>
    </details>}
    {!loading && role !== "player" && role !== "master" && <p className="muted">캐릭터 시트는 플레이어와 마스터만 볼 수 있습니다.</p>}
    {!loading && (role === "player" || role === "master") && !sheets.length && <p className="muted">아직 캐릭터 시트가 없습니다.</p>}
    <div className="character-sheet-list">{sheets.map((sheet) => <details key={sheet.id}>
      <summary><strong>{sheet.name}</strong><span>{SHEET_SYSTEMS[sheet.system]?.label ?? sheet.system}</span></summary>
      <dl>{Object.entries(sheet.attributes).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}</dl>
    </details>)}</div>
  </section>;
}
