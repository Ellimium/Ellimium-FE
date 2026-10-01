"use client";

import { FormEvent, useEffect, useState } from "react";

import { buildAttributes, canEditCharacterSheet, formatSheetEntries, parseSheetEntries, SHEET_SYSTEMS } from "./character-sheet";
import type { SheetSystem } from "./character-sheet";
import { supabase } from "@/lib/supabase/client";

type Role = "master" | "player" | "spectator";
type SheetTab = "attributes" | "skills" | "equipment" | "notes";
type CharacterSheet = {
  id: string;
  owner_id: string;
  name: string;
  system: SheetSystem;
  attributes: Record<string, unknown>;
  skills: Record<string, unknown>;
  equipment: unknown[];
  resources: Record<string, unknown>;
  notes: string;
  backstory: string;
};

const SHEET_FIELDS = "id, owner_id, name, system, attributes, skills, equipment, resources, notes, backstory";
const SHEET_TABS: Record<SheetTab, string> = { attributes: "능력치", skills: "스킬", equipment: "장비", notes: "메모" };

export default function CharacterSheets({ roomId }: { roomId?: string }) {
  const [role, setRole] = useState<Role | null>(null);
  const [userId, setUserId] = useState("");
  const [sheets, setSheets] = useState<CharacterSheet[]>([]);
  const [tabs, setTabs] = useState<Record<string, SheetTab>>({});
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
        supabase.from("character_sheets").select(SHEET_FIELDS).eq("room_id", roomId).order("created_at"),
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
      }).select(SHEET_FIELDS).single();

      if (insertError || !data) {
        setError("캐릭터 시트를 생성하지 못했습니다. 룸과 플레이어 권한을 확인하세요.");
        return;
      }
      setSheets((current) => [...current, data as CharacterSheet]);
      window.dispatchEvent(new CustomEvent("character-sheet-created", { detail: { roomId, character: { id: data.id, name: data.name } } }));
      formElement.reset();
      setSystem("dnd_5e");
      setMessage("캐릭터 시트를 생성했습니다.");
    } catch {
      setError("캐릭터 시트 서버에 연결하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function updateSheet(event: FormEvent<HTMLFormElement>, sheet: CharacterSheet, tab: SheetTab) {
    event.preventDefault();
    if (!canEditCharacterSheet(role, userId, sheet.owner_id)) return;

    const form = new FormData(event.currentTarget);
    let changes: Record<string, unknown>;
    try {
      if (tab === "attributes") changes = {
        attributes: parseSheetEntries(String(form.get("attributes") ?? "")),
        resources: parseSheetEntries(String(form.get("resources") ?? "")),
      };
      else if (tab === "skills") changes = { skills: parseSheetEntries(String(form.get("skills") ?? "")) };
      else if (tab === "equipment") changes = { equipment: String(form.get("equipment") ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean) };
      else changes = { notes: String(form.get("notes") ?? ""), backstory: String(form.get("backstory") ?? "") };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "편집 항목을 확인하세요.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const { data, error: updateError } = await supabase.from("character_sheets").update(changes).eq("id", sheet.id).select(SHEET_FIELDS).single();
      if (updateError || !data) {
        setError("캐릭터 시트를 수정하지 못했습니다. 편집 권한을 확인하세요.");
        return;
      }
      setSheets((current) => current.map((item) => item.id === sheet.id ? data as CharacterSheet : item));
      setMessage(`${sheet.name} 시트를 저장했습니다.`);
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
    <div className="character-sheet-list">{sheets.map((sheet) => {
      const tab = tabs[sheet.id] ?? "attributes";
      const editable = canEditCharacterSheet(role, userId, sheet.owner_id);
      return <details key={sheet.id}>
        <summary><strong>{sheet.name}</strong><span>{SHEET_SYSTEMS[sheet.system]?.label ?? sheet.system}</span></summary>
        <div className="character-sheet-tabs" role="tablist" aria-label={`${sheet.name} 시트 항목`}>{Object.entries(SHEET_TABS).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTabs((current) => ({ ...current, [sheet.id]: value as SheetTab }))}>{label}</button>)}</div>
        {editable ? <form key={tab} className="character-sheet-edit" onSubmit={(event) => updateSheet(event, sheet, tab)}>
          {tab === "attributes" && <><label>능력치<textarea name="attributes" required rows={4} defaultValue={formatSheetEntries(sheet.attributes)} disabled={saving} /></label><label>자원 (HP·MP 등)<textarea name="resources" rows={3} placeholder={"HP=12\nMP=5"} defaultValue={formatSheetEntries(sheet.resources)} disabled={saving} /></label></>}
          {tab === "skills" && <label>스킬 점수<textarea name="skills" rows={5} placeholder={"운동=5\n은신=3"} defaultValue={formatSheetEntries(sheet.skills)} disabled={saving} /></label>}
          {tab === "equipment" && <label>장비·아이템<textarea name="equipment" rows={5} placeholder={"장검\n치유 물약"} defaultValue={sheet.equipment.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n")} disabled={saving} /></label>}
          {tab === "notes" && <><label>메모<textarea name="notes" rows={3} defaultValue={sheet.notes} disabled={saving} /></label><label>배경 이야기<textarea name="backstory" rows={5} defaultValue={sheet.backstory} disabled={saving} /></label></>}
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "저장 중…" : "변경 저장"}</button>
        </form> : <p className="muted character-sheet-readonly">이 시트는 읽기만 가능합니다.</p>}
      </details>;
    })}</div>
  </section>;
}
