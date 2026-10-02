import assert from "node:assert/strict";
import test from "node:test";

import { canSendChat, limitChatContent, mergeChatMessages, messageParts, systemMessageDisplay, visibleChatMessages } from "./chat-message.ts";
import type { ChatMessage } from "./chat-message.ts";

const message = (id: string, created_at: string): ChatMessage => ({
  id,
  room_id: "room",
  sender_id: "sender",
  character_id: null,
  character_name: null,
  mode: "general",
  content: id,
  message_type: "chat",
  event_type: null,
  event_data: null,
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

test("시스템 이벤트별 채팅 표시를 만든다", () => {
  const systemMessage = (event_type: ChatMessage["event_type"], event_data: ChatMessage["event_data"], content = "공지") => ({
    ...message(event_type ?? "system", "2026-10-02T00:00:00Z"),
    message_type: "system" as const,
    event_type,
    event_data,
    content,
  });

  assert.deepEqual(systemMessageDisplay(systemMessage("dice_roll", { visibility: "public", expression: "2d6", individual_results: [3, 4], total: 7 }), "모험가"), { label: "주사위", text: "모험가 · 2d6 [3 + 4] = 7" });
  assert.deepEqual(systemMessageDisplay(systemMessage("dice_roll", { visibility: "private" }), "모험가"), { label: "비공개 주사위", text: "모험가님이 비공개 주사위를 굴렸습니다." });
  assert.deepEqual(systemMessageDisplay(systemMessage("member_joined", { user_id: "user" }), "모험가"), { label: "입장", text: "모험가님이 룸에 입장했습니다." });
  assert.deepEqual(systemMessageDisplay(systemMessage("member_left", { user_id: "user" }), "알 수 없는 사용자"), { label: "퇴장", text: "참가자님이 룸에서 퇴장했습니다." });
  assert.deepEqual(systemMessageDisplay(systemMessage("notification", { created_by: "master" }, "잠시 후 시작합니다."), "마스터"), { label: "알림", text: "잠시 후 시작합니다." });
});

test("시스템 메시지 표시 여부로 채팅을 필터링한다", () => {
  const systemMessage = { ...message("system", "2026-10-02T00:00:00Z"), message_type: "system" as const };
  const messages = [message("chat", "2026-10-02T00:00:01Z"), systemMessage];

  assert.deepEqual(visibleChatMessages(messages, true).map(({ id }) => id), ["chat", "system"]);
  assert.deepEqual(visibleChatMessages(messages, false).map(({ id }) => id), ["chat"]);
});
