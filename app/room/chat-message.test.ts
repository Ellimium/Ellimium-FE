import assert from "node:assert/strict";
import test from "node:test";

import { canSendChat, limitChatContent, mergeChatMessages, messageParts } from "./chat-message.ts";
import type { ChatMessage } from "./chat-message.ts";

const message = (id: string, created_at: string): ChatMessage => ({
  id,
  room_id: "room",
  sender_id: "sender",
  character_id: null,
  character_name: null,
  mode: "general",
  content: id,
  created_at,
});

test("채팅 기록을 시간순으로 합치고 중복 실시간 이벤트를 제거한다", () => {
  const messages = mergeChatMessages(
    [message("later", "2026-09-29T02:00:00Z")],
    [message("earlier", "2026-09-29T01:00:00Z"), message("later", "2026-09-29T02:00:00Z")],
  );

  assert.deepEqual(messages.map(({ id }) => id), ["earlier", "later"]);
});

test("HTTP(S)만 링크로 분리하고 HTML과 실행 가능한 스킴은 텍스트로 둔다", () => {
  const content = '안녕 👋 <script>alert(1)</script> javascript:alert(1) https://example.com/path?x=1.';
  const parts = messageParts(content);

  assert.deepEqual(parts.filter(({ type }) => type === "link").map(({ value }) => value), ["https://example.com/path?x=1"]);
  assert.equal(parts.map(({ value }) => value).join(""), content);
  assert.match(parts[0].value, /<script>/);
});

test("마스터와 플레이어만 채팅을 보낼 수 있다", () => {
  assert.equal(canSendChat("master"), true);
  assert.equal(canSendChat("player"), true);
  assert.equal(canSendChat("spectator"), false);
  assert.equal(canSendChat(null), false);
});

test("이모지를 포함한 입력을 2000자로 제한한다", () => {
  assert.equal(Array.from(limitChatContent("😀".repeat(2001))).length, 2000);
});
