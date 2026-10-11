"use client";

import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { diceErrorMessage } from "./dice-error";
import { diceRollDisplay, mergeDiceRolls, visibleDiceRolls } from "./dice-log";
import type { DiceRollLog, DiceSort, DiceVisibility } from "./dice-log";
import { readDicePage } from "./dice-history";
import type { DiceCursor } from "./dice-history";
import { supabase } from "@/lib/supabase/client";
import { useRoomPermissions } from "./room-permissions";

import { RECORD_CONNECTION_LABELS, startRecordConnection } from "./record-connection";
import { useRecordConnection } from "./room-connection";

type Profile = { user_id: string; nickname: string };

const dateTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" });
type DiceAnchor = { id: string; top: number };
function diceAnchor(list: HTMLDivElement | null): DiceAnchor | null {
  if (!list || !list.clientHeight) return null;
  const top = list.getBoundingClientRect().top;
  const anchor = Array.from(list.querySelectorAll<HTMLElement>("[data-roll-id]"))
    .find((node) => node.getBoundingClientRect().bottom > top);
  return anchor ? { id: anchor.dataset.rollId!, top: anchor.getBoundingClientRect().top - top } : null;
}

export default function DiceRoll({ roomId }: { roomId?: string }) {
  const { role, currentUserId, canUse, loading: permissionLoading, error: permissionError, refreshMembership } = useRoomPermissions();
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

  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState("");
  const [listVisible, setListVisible] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const viewportAnchorRef = useRef<DiceAnchor | null>(null);
  const loadOlderRef = useRef<(() => Promise<void>) | null>(null);
  const generationRef = useRef(0);

  const historyRef = useRef<{ roomId: string; userId: string; role: typeof role; initialized: boolean; oldest: DiceCursor | null } | null>(null);

  const connection = useRecordConnection("dice");
  const publishConnection = connection.publish;

  useEffect(() => {
    let active = true;
    generationRef.current++;
    setRolling(false);
    let version = 0;
    let initialized = false;
    let oldest: DiceCursor | null = null;
    let olderBusy = false;
    loadOlderRef.current = null;
    setLoadingOlder(false);
    const cached = historyRef.current;
    const sameIdentity = cached?.roomId === roomId && cached?.userId === currentUserId;
    if (!role && permissionError && sameIdentity) {
      setLoading(false);
      publishConnection(navigator.onLine ? "error" : "disconnected", () => { void refreshMembership?.(); });
      return;
    }
    const restoring = sameIdentity && cached?.role === role && !permissionLoading;
    if (!restoring) {
      historyRef.current = null;
      setHasOlder(false);
      setOlderError("");
      viewportAnchorRef.current = null;
      setLoadedRole(null);
      setRolls([]);
      setRollerNames({});
    }

    if (!roomId || !role || !currentUserId || permissionLoading) {
      setLoading(false);
      publishConnection(navigator.onLine ? "connecting" : "disconnected", () => {});
      return;
    }

    const history = restoring ? cached! : { roomId, userId: currentUserId, role, initialized: false, oldest: null };
    historyRef.current = history;
    initialized = history.initialized;
    oldest = history.oldest;
    setLoading(!restoring);

    async function loadRecords(request: number) {
      const records: DiceRollLog[] = [];
      const initial = !initialized;
      const since = oldest;
      let before: DiceCursor | null = null;
      for (;;) {
        const result = await readDicePage(supabase, roomId!, before, since);
        if (!active || request !== version) return { data: [], error: null, hasMore: false };
        if (result.error) return result;
        records.push(...result.data);
        if (initial || !result.hasMore) return { data: records, error: null, hasMore: result.hasMore };
        before = result.data.at(-1)!;
      }
    }

    async function loadNames(records: DiceRollLog[]) {
      const ids = [...new Set([currentUserId!, ...records.map((roll) => roll.roller_id)])];
      return await supabase.from("profiles").select("user_id, nickname").in("user_id", ids);
    }

    loadOlderRef.current = async () => {
      if (!initialized || !oldest || olderBusy) return;
      olderBusy = true;
      setLoadingOlder(true);
      setOlderError("");
      try {
        const result = await readDicePage(supabase, roomId!, oldest);
        if (!active) return;
        if (result.error) throw result.error;
        const profiles = await loadNames(result.data);
        if (!active) return;
        if (profiles.error) throw profiles.error;
        viewportAnchorRef.current = diceAnchor(listRef.current) ?? viewportAnchorRef.current;
        oldest = result.data.at(-1) ?? oldest;
        history.oldest = oldest;
        setHasOlder(result.hasMore);
        const names = Object.fromEntries(((profiles.data ?? []) as Profile[]).map((profile) => [profile.user_id, profile.nickname]));
        setRollerNames((current) => ({ ...current, ...names }));
        setRolls((current) => mergeDiceRolls(current, result.data));
      } catch {
        if (active) setOlderError("이전 주사위 기록을 불러오지 못했습니다. 다시 시도해 주세요.");
      } finally {
        olderBusy = false;
        if (active) setLoadingOlder(false);
      }
    };

    async function load() {
      const request = ++version;
      setError("");
      try {
        const result = await loadRecords(request);

        if (!active || request !== version) return;
        if (result.error) {
          setError("주사위 기록을 불러오지 못했습니다.");
          setLoading(false);
          return false;
        }

        const nextRolls = result.data;
        const { data: profileData, error: profileError } = await loadNames(nextRolls);
        if (!active || request !== version) return;
        if (profileError) {
          setError("주사위 기록의 사용자 정보를 불러오지 못했습니다.");
          setLoading(false);
          return false;
        }

        if (!initialized) {
          oldest = result.data.at(-1) ?? null;
          setHasOlder(result.hasMore);
          initialized = true;
        } else if (!oldest && result.data.length) {
          oldest = result.data.at(-1)!;
        }
        viewportAnchorRef.current = diceAnchor(listRef.current) ?? viewportAnchorRef.current;
        history.initialized = initialized;
        history.oldest = oldest;
        setLoadedRole(role);
        setRolls((current) => mergeDiceRolls(current, nextRolls));
        const names = Object.fromEntries(((profileData ?? []) as Profile[]).map((profile) => [profile.user_id, profile.nickname]));
        setRollerNames((current) => ({ ...current, ...names }));
        setLoading(false);
        return true;
      } catch {
        if (active && request === version) {
          setError("주사위 서버에 연결하지 못했습니다.");
          setLoading(false);
          return false;
        }
      }
    }

    function receive(roll: DiceRollLog) {
      if (!active || !roll.id || roll.room_id !== roomId) return;
      setRolls((current) => mergeDiceRolls(current, roll));
      void loadNames([roll]).then(({ data, error }) => {
        if (!active || error) return;
        const names = Object.fromEntries(((data ?? []) as Profile[]).map((profile) => [profile.user_id, profile.nickname]));
        setRollerNames((current) => ({ ...current, ...names }));
      }).catch(() => {});
    }

    const createChannel = () => supabase
      .channel(`room:${roomId}:dice`, { config: { private: true, postgres_changes_options: { wait: true } } })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "dice_rolls",
        filter: `room_id=eq.${roomId}`,
      }, ({ new: inserted }) => {
        receive(inserted as DiceRollLog);
      })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "dice_roll_notifications",
        filter: `room_id=eq.${roomId}`,
      }, ({ new: inserted }) => {
        receive(inserted as DiceRollLog);
      });

    const disposeConnection = startRecordConnection(supabase, createChannel, load, publishConnection, { window, online: navigator.onLine });
    return () => {
      active = false;
      generationRef.current++;
      version++;
      loadOlderRef.current = null;
      disposeConnection();
      publishConnection("connecting", () => {});
    };
  }, [currentUserId, permissionError, permissionLoading, publishConnection, refreshMembership, role, roomId]);

  const canRoll = Boolean(role) && !loading && loadedRole === role && !permissionLoading && canUse("dice");
  const rollers = useMemo(() => [...new Set(rolls.map((roll) => roll.roller_id))].map((id) => ({ id, name: rollerNames[id] ?? "알 수 없는 사용자" })), [rolls, rollerNames]);
  const visibleRolls = useMemo(() => visibleDiceRolls(loadedRole === role ? rolls : [], rollerNames, rollerFilter, visibilityFilter, search, sort), [loadedRole, role, rolls, rollerNames, rollerFilter, visibilityFilter, search, sort]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => setListVisible(list.clientHeight > 0));
    observer.observe(list);
    return () => observer.disconnect();
  }, [roomId]);

  useLayoutEffect(() => {
    viewportAnchorRef.current = null;
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [rollerFilter, visibilityFilter, search, sort]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !list.clientHeight || loading || loadedRole !== role) return;
    const saved = viewportAnchorRef.current;
    if (saved) {
      const anchor = Array.from(list.querySelectorAll<HTMLElement>("[data-roll-id]")).find((node) => node.dataset.rollId === saved.id);
      if (anchor) list.scrollTop += anchor.getBoundingClientRect().top - list.getBoundingClientRect().top - saved.top;
    }
    viewportAnchorRef.current = diceAnchor(list);
  }, [visibleRolls, loadedRole, role, loading, listVisible]);

  async function roll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomId || !canRoll || !expression.trim()) return;

    const generation = generationRef.current;
    setRolling(true);
    setError("");
    try {
      const { data, error: rollError } = await supabase.rpc("roll_dice", {
        target_room_id: roomId,
        dice_expression: expression.trim(),
        roll_visibility: visibility,
      });
      if (generation !== generationRef.current) return;
      if (rollError) {
        setError(diceErrorMessage(rollError));
        return;
      }

      const result = (Array.isArray(data) ? data[0] : data) as DiceRollLog | null;
      if (!result?.id) {
        setError("주사위 요청을 처리하지 못했습니다.");
        return;
      }
      setRolls((current) => mergeDiceRolls(current, result));
      setExpression("");
    } catch {
      if (generation === generationRef.current) setError("주사위 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      if (generation === generationRef.current) setRolling(false);
    }
  }

  return <section className="chat-panel dice-panel" aria-label="주사위" aria-busy={loading || loadingOlder || rolling || connection.state === "syncing"}>
    <div className="panel-tabs"><button className="active" type="button">주사위</button><span>기록</span><span role="status" className={`record-status record-status-${connection.state}`}>{RECORD_CONNECTION_LABELS[connection.state]}</span></div>
    {(connection.state === "error" || connection.state === "disconnected") && <button className="record-retry" type="button" onClick={connection.retry} aria-label="주사위 연결 및 기록 다시 시도">다시 시도</button>}
    <div className="dice-log-tools">
      <input type="search" aria-label="주사위 로그 검색" aria-describedby="dice-search-scope" placeholder="로그 검색" value={search} onChange={(event) => setSearch(event.target.value)} />
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
    {!loading && role && loadedRole === role && <div className="dice-history-controls">
      <p id="dice-search-scope">검색·필터는 불러온 기록 {rolls.length}건에만 적용됩니다.</p>
      {hasOlder ? <button type="button" disabled={loadingOlder} onClick={() => { void loadOlderRef.current?.(); }}>{loadingOlder ? "이전 기록을 불러오는 중…" : olderError ? "이전 기록 다시 시도" : "이전 기록 더 불러오기"}</button>
        : <span>모든 주사위 기록을 불러왔습니다.</span>}
      {olderError && <p className="form-error" role="alert">{olderError}</p>}
    </div>}
    <div className="messages dice-list" ref={listRef} onScroll={(event) => {
      if (loading || !role || loadedRole !== role) return;
      const anchor = diceAnchor(event.currentTarget);
      if (anchor) viewportAnchorRef.current = anchor;
    }} role="log" aria-live="polite" aria-relevant="additions">
      {loading && <p className="system-message">주사위 기록을 불러오는 중…</p>}
      {!loading && !rolls.length && <p className="system-message">아직 주사위 기록이 없습니다.</p>}
      {!loading && rolls.length > 0 && !visibleRolls.length && <p className="system-message">조건에 맞는 주사위 기록이 없습니다.</p>}
      {visibleRolls.map((roll) => {
        const display = diceRollDisplay(roll);
        return <div className={`dice-message dice-message-${roll.visibility}`} key={roll.id} data-roll-id={roll.id}>
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
