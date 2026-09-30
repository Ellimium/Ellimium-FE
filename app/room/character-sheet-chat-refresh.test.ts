import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("시트 생성 성공 후 같은 화면에서 새 캐릭터로 IC 채팅을 보낸다", () => {
  const characterSheets = readFileSync(new URL("character-sheets.tsx", import.meta.url), "utf8");
  const chat = readFileSync(new URL("chat.tsx", import.meta.url), "utf8");

  assert.match(characterSheets, /if \(insertError \|\| !data\) \{[\s\S]*?return;[\s\S]*?\}\s*setSheets[\s\S]*?window\.dispatchEvent\(new CustomEvent\("character-sheet-created"/);
  assert.match(chat, /window\.addEventListener\("character-sheet-created", addCharacter\);[\s\S]*?window\.removeEventListener\("character-sheet-created", addCharacter\)/);
  assert.match(chat, /created\.roomId === roomId[\s\S]*?setCharacters[\s\S]*?created\.character/);
  assert.match(chat, /characters\.map\([\s\S]*?<option[\s\S]*?value=\{character\.id\}/);
  assert.match(chat, /target_character_id: mode === "ic" && characterId \? characterId : null/);
});
