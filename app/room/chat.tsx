"use client";

import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

import { canSendChat, CHAT_MESSAGE_LIMIT, limitChatContent, mergeChatMessages, messageParts, systemMessageDisplay, visibleChatMessages } from "./chat-message";
import type { ChatMessage, ChatMode } from "./chat-message";
import { CHAT_HISTORY_PAGE_SIZE, readChatPage } from "./chat-history";
import type { ChatCursor } from "./chat-history";
import { supabase } from "@/lib/supabase/client";
import { useRoomPermissions } from "./room-permissions";

import { RECORD_CONNECTION_LABELS, startRecordConnection } from "./record-connection";
import { useRecordConnection } from "./room-connection";

type Profile = { user_id: string; nickname: string };
type Character = { id: string; name: string };

const MODE_NAMES: Record<ChatMode, string> = { general: "일반", ic: "IC", ooc: "OOC" };
const dateTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" });

function isNearBottom(list: HTMLDivElement) {
  return list.scrollHeight - list.clientHeight - list.scrollTop <= 48;
}

type ChatAnchor = { id: string; top: number };
function chatAnchor(list: HTMLDivElement | null): ChatAnchor | null {
  if (!list || !list.clientHeight) return null;
  const top = list.getBoundingClientRect().top;
  const anchor = Array.from(list.querySelectorAll<HTMLElement>("[data-message-id]"))
    .find((node) => node.getBoundingClientRect().bottom > top);
  return anchor ? { id: anchor.dataset.messageId!, top: anchor.getBoundingClientRect().top - top } : null;
}

export default function Chat({ roomId }: { roomId?: string }) {
  const { role, currentUserId, canUse, loading: permissionLoading, error: permissionError, refreshMembership } = useRoomPermissions();
  const [loadedRole, setLoadedRole] = useState<typeof role>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [senderNames, setSenderNames] = useState<Record<string, string>>({});
  const [characters, setCharacters] = useState<Character[]>([]);
  const [mode, setMode] = useState<ChatMode>("general");
  const [characterId, setCharacterId] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(Boolean(roomId));
  const [sending, setSending] = useState(false);
  const [showSystemMessages, setShowSystemMessages] = useState(true);
  const [error, setError] = useState("");
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [listVisible, setListVisible] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const previousMessageIdsRef = useRef(new Set<string>());
  const senderNamesRef = useRef<Record<string, string>>({});

  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState("");
  const loadOlderRef = useRef<(() => Promise<void>) | null>(null);
  const olderMessageIdsRef = useRef(new Set<string>());
  const prependAnchorRef = useRef<ChatAnchor | null>(null);
  const viewportAnchorRef = useRef<ChatAnchor | null>(null);

  const historyRef = useRef<{ roomId: string; userId: string; role: typeof role; initialized: boolean; oldest: ChatCursor | null } | null>(null);

  const connection = useRecordConnection("chat");
  const publishConnection = connection.publish;

  useEffect(() => {
    let active = true;
    let version = 0;
    let initialized = false;
    let oldest: ChatCursor | null = null;
    let olderBusy = false;
    const liveMessageIds = new Set<string>();
    loadOlderRef.current = null;
    setLoadingOlder(false);
    const cached = historyRef.current;
    const sameIdentity = cached?.roomId === roomId && cached?.userId === currentUserId;
    if (!role && permissionError && sameIdentity) {
      setLoading(false);
      prependAnchorRef.current = viewportAnchorRef.current;
      publishConnection(navigator.onLine ? "error" : "disconnected", () => { void refreshMembership?.(); });
      return;
    }
    const restoring = sameIdentity && cached?.role === role && !permissionLoading;
    if (!restoring) {
      historyRef.current = null;
      setHasOlder(false);
      setOlderError("");
      olderMessageIdsRef.current.clear();
      prependAnchorRef.current = null;
      viewportAnchorRef.current = null;
      setLoadedRole(null);
      setMessages([]);
      followLatestRef.current = true;
      previousMessageIdsRef.current.clear();
      setHasNewMessages(false);
      setSenderNames({});
      senderNamesRef.current = {};
      setCharacters([]);
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

    async function loadMessages(request: number) {
      const messages: ChatMessage[] = [];
      const initial = !initialized;
      const since = oldest;
      let before: ChatCursor | null = null;
      for (;;) {
        const result = await readChatPage(supabase, roomId!, before, since);
        if (!active || request !== version) return { data: [], error: null };
        if (result.error) return result;
        messages.push(...result.data);
        if (initial || result.data.length < CHAT_HISTORY_PAGE_SIZE) return { data: messages, error: null };
        before = result.data.at(-1)!;
      }
    }

    async function loadSenderNames(messages: ChatMessage[]) {
      const senderIds = [...new Set(messages.flatMap((message) =>
        message.sender_id && !senderNamesRef.current[message.sender_id] ? [message.sender_id] : []))];
      return senderIds.length
        ? await supabase.from("profiles").select("user_id, nickname").in("user_id", senderIds)
        : { data: [], error: null };
    }

    loadOlderRef.current = async () => {
      if (!initialized || !oldest || olderBusy) return;
      olderBusy = true;
      setLoadingOlder(true);
      setOlderError("");
      try {
        const result = await readChatPage(supabase, roomId!, oldest);
        if (!active) return;
        if (result.error) throw result.error;
        const profiles = await loadSenderNames(result.data);
        if (!active) return;
        if (profiles.error) throw profiles.error;
        const names = Object.fromEntries(((profiles.data ?? []) as Profile[]).map((profile) => [profile.user_id, profile.nickname]));
        senderNamesRef.current = { ...senderNamesRef.current, ...names };
        setSenderNames(senderNamesRef.current);
        prependAnchorRef.current = chatAnchor(listRef.current) ?? viewportAnchorRef.current;
        for (const message of result.data) {
          if (!liveMessageIds.has(message.id)) olderMessageIdsRef.current.add(message.id);
        }
        oldest = result.data.at(-1) ?? oldest;
        history.oldest = oldest;
        setHasOlder(result.data.length === CHAT_HISTORY_PAGE_SIZE);
        setMessages((current) => mergeChatMessages(current, result.data));
      } catch {
        if (active) setOlderError("이전 채팅 기록을 불러오지 못했습니다. 다시 시도해 주세요.");
      } finally {
        olderBusy = false;
        if (active) setLoadingOlder(false);
      }
    };

    async function load() {
      const request = ++version;
      setError("");

      try {
        const [messageResult, characterResult] = await Promise.all([
          loadMessages(request),
          supabase.from("character_sheets").select("id, name").eq("room_id", roomId).order("created_at"),
        ]);

        if (!active || request !== version) return;
        if (messageResult.error || characterResult.error) {
          setError("채팅 기록과 권한을 불러오지 못했습니다.");
          setLoading(false);
          return false;
        }

        const profileResult = await loadSenderNames(messageResult.data ?? []);

        if (!active || request !== version) return;
        if (profileResult.error) {
          setError("채팅 발신자 정보를 불러오지 못했습니다.");
          setLoading(false);
          return false;
        }

        if (!initialized) {
          oldest = messageResult.data.at(-1) ?? null;
          setHasOlder(messageResult.data.length === CHAT_HISTORY_PAGE_SIZE);
          initialized = true;
        } else if (!oldest && messageResult.data.length) {
          oldest = messageResult.data.at(-1)!;
        }
        history.initialized = initialized;
        history.oldest = oldest;
        setLoadedRole(role);
        const names = Object.fromEntries(((profileResult.data ?? []) as Profile[]).map((profile) => [profile.user_id, profile.nickname]));
        senderNamesRef.current = { ...senderNamesRef.current, ...names };
        setSenderNames(senderNamesRef.current);
        setCharacters((characterResult.data ?? []) as Character[]);
        if (!followLatestRef.current && !prependAnchorRef.current) {
          prependAnchorRef.current = chatAnchor(listRef.current) ?? viewportAnchorRef.current;
        }
        setMessages((current) => mergeChatMessages(current, (messageResult.data ?? []) as ChatMessage[]));
        setLoading(false);
        return true;
      } catch {
        if (active && request === version) {
          setError("채팅 서버에 연결하지 못했습니다.");
          setLoading(false);
          return false;
        }
      }
    }

    const createChannel = () => supabase
      .channel(`room:${roomId}:chat`, { config: { postgres_changes_options: { wait: true } } })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `room_id=eq.${roomId}`,
      }, ({ new: inserted }) => {
        if (!active) return;
        const message = inserted as ChatMessage;
        if (!message.id || message.room_id !== roomId) return;

        liveMessageIds.add(message.id);
        setMessages((current) => mergeChatMessages(current, message));
        if (message.sender_id && !senderNamesRef.current[message.sender_id]) void supabase
          .from("profiles")
          .select("user_id, nickname")
          .eq("user_id", message.sender_id)
          .maybeSingle()
          .then(({ data }) => {
            if (!active || !data) return;
            senderNamesRef.current = { ...senderNamesRef.current, [data.user_id]: data.nickname };
            setSenderNames(senderNamesRef.current);
          });
      });

    const disposeConnection = startRecordConnection(supabase, createChannel, load, publishConnection, { window, online: navigator.onLine });
    return () => {
      active = false;
      version++;
      loadOlderRef.current = null;
      disposeConnection();
      publishConnection("connecting", () => {});
    };
  }, [currentUserId, permissionError, permissionLoading, publishConnection, refreshMembership, role, roomId]);

  useEffect(() => {
    if (!roomId) return;

    function addCharacter(event: Event) {
      const created = (event as CustomEvent<{ roomId: string; character: Character }>).detail;
      if (created.roomId === roomId) setCharacters((current) => current.some(({ id }) => id === created.character.id) ? current : [...current, created.character]);
    }

    window.addEventListener("character-sheet-created", addCharacter);
    return () => window.removeEventListener("character-sheet-created", addCharacter);
  }, [roomId]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => setListVisible(list.clientHeight > 0));
    observer.observe(list);
    return () => observer.disconnect();
  }, [roomId]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || list.clientHeight === 0 || loading || loadedRole !== role) return;
    const receivedVisibleMessage = visibleChatMessages(messages, showSystemMessages)
      .some((message) => !previousMessageIdsRef.current.has(message.id) && !olderMessageIdsRef.current.has(message.id));
    previousMessageIdsRef.current = new Set(messages.map((message) => message.id));
    const pendingAnchor = prependAnchorRef.current;
    if (pendingAnchor) {
      const anchor = Array.from(list.querySelectorAll<HTMLElement>("[data-message-id]")).find((node) => node.dataset.messageId === pendingAnchor.id);
      if (anchor) list.scrollTop += anchor.getBoundingClientRect().top - list.getBoundingClientRect().top - pendingAnchor.top;
      prependAnchorRef.current = null;
    } else if (followLatestRef.current) list.scrollTop = list.scrollHeight;
    if ((!followLatestRef.current || pendingAnchor) && receivedVisibleMessage) setHasNewMessages(true);
    olderMessageIdsRef.current.clear();
    if (list.scrollHeight - list.clientHeight - list.scrollTop <= 1) setHasNewMessages(false);
    followLatestRef.current = isNearBottom(list);
    viewportAnchorRef.current = chatAnchor(list);
  }, [messages, loading, showSystemMessages, loadedRole, role, listVisible]);

  const canSend = !loading && loadedRole === role && canSendChat(role, !permissionLoading && canUse("chat"));
  const visibleCharacters = loadedRole === role ? characters : [];
  const visibleMessages = visibleChatMessages(loadedRole === role ? messages : [], showSystemMessages);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomId || !canSend || !content.trim()) return;

    setSending(true);
    setError("");
    try {
      const { data, error: sendError } = await supabase.rpc("send_chat_message", {
        target_room_id: roomId,
        message_mode: mode,
        message_content: content,
        target_character_id: mode === "ic" && characterId ? characterId : null,
      });

      if (sendError) {
        setError(sendError.code === "42501" ? "채팅 전송 권한이 없습니다." : "메시지를 전송하지 못했습니다.");
        return;
      }

      const created = (Array.isArray(data) ? data[0] : data) as ChatMessage | null;
      if (!created?.id) {
        setError("전송된 메시지를 확인하지 못했습니다.");
        return;
      }

      setMessages((current) => mergeChatMessages(current, created));
      setContent("");
    } catch {
      setError("채팅 서버에 연결하지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  if (!roomId) return null;

  return <section className="chat-panel realtime-chat" aria-label="실시간 채팅" aria-busy={loading || loadingOlder || sending || connection.state === "syncing"}>
    <div className="panel-tabs"><span className="active">채팅</span><button className={showSystemMessages ? "active" : ""} type="button" aria-pressed={showSystemMessages} onClick={() => setShowSystemMessages((current) => !current)}>{showSystemMessages ? "시스템 숨기기" : "시스템 보기"}</button><span role="status" className={`record-status record-status-${connection.state}`}>{RECORD_CONNECTION_LABELS[connection.state]}</span></div>
    {(connection.state === "error" || connection.state === "disconnected") && <button className="record-retry" type="button" onClick={connection.retry} aria-label="채팅 연결 및 기록 다시 시도">다시 시도</button>}
    {!loading && role && loadedRole === role && <div className="chat-history-controls">
      {hasOlder ? <button type="button" disabled={loadingOlder} onClick={() => { void loadOlderRef.current?.(); }}>{loadingOlder ? "이전 기록을 불러오는 중…" : olderError ? "이전 기록 다시 시도" : "이전 기록 더 불러오기"}</button>
        : <span>모든 채팅 기록을 불러왔습니다.</span>}
      {olderError && <p className="form-error" role="alert">{olderError}</p>}
    </div>}
    <div className="chat-history">
      <div className="messages chat-messages" ref={listRef} onScroll={(event) => {
        if (loading || !role || loadedRole !== role || event.currentTarget.clientHeight === 0) return;
        const list = event.currentTarget;
        followLatestRef.current = isNearBottom(list);
        viewportAnchorRef.current = chatAnchor(list);
        if (list.scrollHeight - list.clientHeight - list.scrollTop <= 1) setHasNewMessages(false);
      }} role="log" aria-live="polite" aria-relevant="additions">
        {loading && <p className="system-message">채팅 기록을 불러오는 중…</p>}
        {!loading && !visibleMessages.length && <p className="system-message">{messages.length ? "시스템 메시지가 숨겨져 있습니다." : "첫 메시지를 보내 대화를 시작하세요."}</p>}
        {visibleMessages.map((message) => {
          const senderName = message.sender_id ? senderNames[message.sender_id] ?? "알 수 없는 사용자" : "시스템";
          if (message.message_type === "system") {
            const display = systemMessageDisplay(message, senderName);
            return <article className={`chat-system-message chat-system-message-${message.event_type ?? "unknown"}`} key={message.id} data-message-id={message.id}>
              <header><strong>{display.label}</strong><time dateTime={message.created_at}>{dateTime.format(new Date(message.created_at))}</time></header>
              <p>{display.text}</p>
            </article>;
          }

          return <article className={`message chat-message chat-message-${message.mode}`} key={message.id} data-message-id={message.id}>
            <header><strong>{message.character_name ?? senderName}</strong><span>{MODE_NAMES[message.mode]}{message.character_name ? ` · ${senderName}` : ""}</span><time dateTime={message.created_at}>{dateTime.format(new Date(message.created_at))}</time></header>
            <p>{messageParts(message.content).map((part, index) => part.type === "link"
              ? <a key={`${part.value}-${index}`} href={part.value} target="_blank" rel="noreferrer">{part.value}</a>
              : <span key={index}>{part.value}</span>)}</p>
          </article>;
        })}
      </div>
      {hasNewMessages && <button className="chat-new-messages" type="button" aria-label="새 메시지 확인 · 최신으로 이동" onClick={() => {
        const list = listRef.current;
        if (!list) return;
        list.scrollTop = list.scrollHeight;
        followLatestRef.current = true;
        setHasNewMessages(false);
      }}><span role="status">새 메시지가 있습니다</span> · 최신으로 이동</button>}
    </div>
    {error && <p className="form-error chat-error" role="alert">{error}</p>}
    {!permissionLoading && role && !canSend && <p className="chat-notice">채팅 기록은 읽을 수 있지만 메시지 전송 권한이 없습니다.</p>}
    <form className="chat-composer" onSubmit={send}>
      <div className="chat-options">
        <select aria-label="채팅 유형" value={mode} disabled={!canSend || loading || sending} onChange={(event) => setMode(event.target.value as ChatMode)}>
          {Object.entries(MODE_NAMES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </select>
        {mode === "ic" && <select aria-label="발언 캐릭터" value={characterId} disabled={!canSend || loading || sending} onChange={(event) => setCharacterId(event.target.value)}>
          <option value="">캐릭터 선택 안 함</option>
          {visibleCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
        </select>}
        <span>{Array.from(content).length} / {CHAT_MESSAGE_LIMIT}</span>
      </div>
      <div className="chat-input">
        <textarea aria-label="채팅 메시지" rows={2} value={content} placeholder={canSend ? "메시지를 입력하세요" : "읽기 전용"} disabled={!canSend || loading || sending} onChange={(event) => setContent(limitChatContent(event.target.value))} />
        <button type="submit" aria-label="메시지 보내기" disabled={!canSend || loading || sending || !content.trim()}>{sending ? "…" : "↑"}</button>
      </div>
    </form>
  </section>;
}
