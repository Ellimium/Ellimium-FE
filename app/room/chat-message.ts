export type ChatMode = "general" | "ic" | "ooc";

export type ChatMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  character_id: string | null;
  character_name: string | null;
  mode: ChatMode;
  content: string;
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

export function canSendChat(role: string | null) {
  return role === "master" || role === "player";
}
