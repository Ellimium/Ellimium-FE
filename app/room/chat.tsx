"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { canSendChat, CHAT_MESSAGE_LIMIT, limitChatContent, mergeChatMessages, messageParts } from "./chat-message";
import type { ChatMessage, ChatMode } from "./chat-message";
import { supabase } from "@/lib/supabase/client";

type Role = "master" | "player" | "spectator";
type Member = { user_id: string; role: Role };
type Profile = { user_id: string; nickname: string };
type Character = { id: string; name: string };

const MESSAGE_FIELDS = "id, room_id, sender_id, character_id, character_name, mode, content, created_at";
const MODE_NAMES: Record<ChatMode, string> = { general: "일반", ic: "IC", ooc: "OOC" };
const dateTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" });

export default function Chat({ roomId }: { roomId?: string }) {
  const [role, setRole] = useState<Role | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [senderNames, setSenderNames] = useState<Record<string, string>>({});
  const [characters, setCharacters] = useState<Character[]>([]);
  const [mode, setMode] = useState<ChatMode>("general");
  const [characterId, setCharacterId] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(Boolean(roomId));
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const senderNamesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let active = true;

    if (!roomId) {
      setLoading(false);
      return;
    }

    async function load() {
      setRole(null);
      setMessages([]);
      setSenderNames({});
      senderNamesRef.current = {};
      setCharacters([]);
      setLoading(true);
      setError("");

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!active) return;
        if (!user) {
          setError("채팅 권한을 확인할 수 없습니다.");
          setLoading(false);
          return;
        }

        const [memberResult, messageResult, characterResult] = await Promise.all([
          supabase.from("room_members").select("user_id, role").eq("room_id", roomId).eq("status", "active").order("joined_at"),
          supabase.from("chat_messages").select(MESSAGE_FIELDS).eq("room_id", roomId).order("created_at").order("id"),
          supabase.from("character_sheets").select("id, name").eq("room_id", roomId).order("created_at"),
        ]);

        if (!active) return;
        if (memberResult.error || messageResult.error || characterResult.error) {
          setError("채팅 기록과 권한을 불러오지 못했습니다.");
          setLoading(false);
          return;
        }

        const members = (memberResult.data ?? []) as Member[];
        const profileResult = members.length
          ? await supabase.from("profiles").select("user_id, nickname").in("user_id", members.map((member) => member.user_id))
          : { data: [], error: null };

        if (!active) return;
        if (profileResult.error) {
          setError("채팅 발신자 정보를 불러오지 못했습니다.");
          setLoading(false);
          return;
        }

        setRole(members.find((member) => member.user_id === user.id)?.role ?? null);
        const names = Object.fromEntries(((profileResult.data ?? []) as Profile[]).map((profile) => [profile.user_id, profile.nickname]));
        senderNamesRef.current = names;
        setSenderNames(names);
        setCharacters((characterResult.data ?? []) as Character[]);
        setMessages((current) => mergeChatMessages(current, (messageResult.data ?? []) as ChatMessage[]));
        setLoading(false);
      } catch {
        if (active) {
          setError("채팅 서버에 연결하지 못했습니다.");
          setLoading(false);
        }
      }
    }

    void load();
    return () => { active = false; };
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;

    function addCharacter(event: Event) {
      const created = (event as CustomEvent<{ roomId: string; character: Character }>).detail;
      if (created.roomId === roomId) setCharacters((current) => current.some(({ id }) => id === created.character.id) ? current : [...current, created.character]);
    }

    window.addEventListener("character-sheet-created", addCharacter);
    return () => window.removeEventListener("character-sheet-created", addCharacter);
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;

    let active = true;
    setConnected(false);
    const channel = supabase
      .channel(`room:${roomId}:chat`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `room_id=eq.${roomId}`,
      }, ({ new: inserted }) => {
        const message = inserted as ChatMessage;
        if (!message.id || message.room_id !== roomId) return;

        setMessages((current) => mergeChatMessages(current, message));
        if (!senderNamesRef.current[message.sender_id]) void supabase
          .from("profiles")
          .select("user_id, nickname")
          .eq("user_id", message.sender_id)
          .maybeSingle()
          .then(({ data }) => {
            if (!active || !data) return;
            senderNamesRef.current = { ...senderNamesRef.current, [data.user_id]: data.nickname };
            setSenderNames(senderNamesRef.current);
          });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnected(true);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setConnected(false);
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const canSend = canSendChat(role);

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

  return <section className="chat-panel realtime-chat" aria-label="실시간 채팅" aria-busy={loading || sending}>
    <div className="panel-tabs"><span className="active">채팅</span><span className={connected ? "chat-connected" : ""}>{connected ? "실시간 연결됨" : "연결 중"}</span></div>
    <div className="messages chat-messages" ref={listRef} role="log" aria-live="polite" aria-relevant="additions">
      {loading && <p className="system-message">채팅 기록을 불러오는 중…</p>}
      {!loading && !messages.length && <p className="system-message">첫 메시지를 보내 대화를 시작하세요.</p>}
      {messages.map((message) => {
        const senderName = senderNames[message.sender_id] ?? "알 수 없는 사용자";
        return <article className={`message chat-message chat-message-${message.mode}`} key={message.id}>
          <header><strong>{message.character_name ?? senderName}</strong><span>{MODE_NAMES[message.mode]}{message.character_name ? ` · ${senderName}` : ""}</span><time dateTime={message.created_at}>{dateTime.format(new Date(message.created_at))}</time></header>
          <p>{messageParts(message.content).map((part, index) => part.type === "link"
            ? <a key={`${part.value}-${index}`} href={part.value} target="_blank" rel="noreferrer">{part.value}</a>
            : <span key={index}>{part.value}</span>)}</p>
        </article>;
      })}
    </div>
    {error && <p className="form-error chat-error" role="alert">{error}</p>}
    {role === "spectator" && <p className="chat-notice">관전자는 채팅을 읽을 수 있지만 메시지를 보낼 수 없습니다.</p>}
    <form className="chat-composer" onSubmit={send}>
      <div className="chat-options">
        <select aria-label="채팅 유형" value={mode} disabled={!canSend || loading || sending} onChange={(event) => setMode(event.target.value as ChatMode)}>
          {Object.entries(MODE_NAMES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </select>
        {mode === "ic" && <select aria-label="발언 캐릭터" value={characterId} disabled={!canSend || loading || sending} onChange={(event) => setCharacterId(event.target.value)}>
          <option value="">캐릭터 선택 안 함</option>
          {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
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
