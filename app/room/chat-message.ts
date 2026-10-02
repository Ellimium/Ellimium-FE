export type ChatMode = "general" | "ic" | "ooc";
export type ChatEventType = "dice_roll" | "member_joined" | "member_left" | "notification";

export type ChatMessage = {
  id: string;
  room_id: string;
  sender_id: string | null;
  character_id: string | null;
  character_name: string | null;
  mode: ChatMode;
  content: string;
  message_type: "chat" | "system";
  event_type: ChatEventType | null;
  event_data: Record<string, unknown> | null;
  created_at: string;
};

export type MessagePart = { type: "text" | "link"; value: string };

export const CHAT_MESSAGE_LIMIT = 2000;
const HTTP_URL = /https?:\/\/[^\s<>"']*[^\s<>"'.,!?;:)\]}]/giu;

export function limitChatContent(content: string) {
  return Array.from(content).slice(0, CHAT_MESSAGE_LIMIT).join("");
}

export function messageParts(content: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let offset = 0;

  for (const match of content.matchAll(HTTP_URL)) {
    const index = match.index ?? 0;
    if (index > offset) parts.push({ type: "text", value: content.slice(offset, index) });
    parts.push({ type: "link", value: match[0] });
    offset = index + match[0].length;
  }

  if (offset < content.length) parts.push({ type: "text", value: content.slice(offset) });
  return parts.length ? parts : [{ type: "text", value: content }];
}

export function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage | ChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of Array.isArray(incoming) ? incoming : [incoming]) byId.set(message.id, message);

  return [...byId.values()].sort((left, right) =>
    Date.parse(left.created_at) - Date.parse(right.created_at) || left.id.localeCompare(right.id));
}

export function visibleChatMessages(messages: ChatMessage[], showSystemMessages: boolean) {
  return showSystemMessages ? messages : messages.filter((message) => message.message_type !== "system");
}

export function systemMessageDisplay(message: ChatMessage, senderName: string) {
  const actor = senderName === "알 수 없는 사용자" ? "참가자" : senderName;
  const data = message.event_data ?? {};

  if (message.event_type === "dice_roll") {
    if (data.visibility === "private") return { label: "비공개 주사위", text: `${actor}님이 비공개 주사위를 굴렸습니다.` };

    const expression = typeof data.expression === "string" ? data.expression : null;
    const results = Array.isArray(data.individual_results) ? data.individual_results.join(" + ") : null;
    const total = typeof data.total === "number" || typeof data.total === "string" ? String(data.total) : null;
    if (expression && total) return { label: "주사위", text: `${actor} · ${expression}${results ? ` [${results}]` : ""} = ${total}` };
  }

  if (message.event_type === "member_joined") return { label: "입장", text: `${actor}님이 룸에 입장했습니다.` };
  if (message.event_type === "member_left") return { label: "퇴장", text: `${actor}님이 룸에서 퇴장했습니다.` };
  if (message.event_type === "notification") return { label: "알림", text: message.content };
  return { label: "시스템", text: message.content };
}

export function canSendChat(role: string | null) {
  return role === "master" || role === "player";
}
