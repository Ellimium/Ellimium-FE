import assert from "node:assert/strict";
import test from "node:test";
import { updateSheetDraft } from "./character-sheet-drafts.ts";

test("메모에서 다른 탭을 편집한 뒤 돌아와도 모든 탭의 원문을 보존한다", () => {
  const notes = updateSheetDraft({}, "sheet-a", "notes", "notes", "미저장 메모\n  공백 포함");
  const backstory = updateSheetDraft(notes, "sheet-a", "notes", "backstory", "배경 이야기");
  const skills = updateSheetDraft(backstory, "sheet-a", "skills", "skills", "아직 파싱할 수 없는 입력=");
  const attributes = updateSheetDraft(skills, "sheet-a", "attributes", "attributes", "STR=12");
  const resources = updateSheetDraft(attributes, "sheet-a", "attributes", "resources", "HP=3");
  const equipment = updateSheetDraft(resources, "sheet-a", "equipment", "equipment", "장검\n물약");

  assert.deepEqual(equipment["sheet-a"], {
    notes: { notes: "미저장 메모\n  공백 포함", backstory: "배경 이야기" },
    skills: { skills: "아직 파싱할 수 없는 입력=" },
    attributes: { attributes: "STR=12", resources: "HP=3" },
    equipment: { equipment: "장검\n물약" },
  });
  assert.deepEqual(notes["sheet-a"], { notes: { notes: "미저장 메모\n  공백 포함" } });
});

test("여러 시트의 같은 탭을 번갈아 편집하고 내용을 비워도 초안이 섞이지 않는다", () => {
  const first = updateSheetDraft({}, "sheet-a", "notes", "notes", "첫 시트");
  const second = updateSheetDraft(first, "sheet-b", "notes", "notes", "두 번째 시트");
  const cleared = updateSheetDraft(second, "sheet-a", "notes", "notes", "");

  assert.equal(cleared["sheet-a"].notes?.notes, "");
  assert.equal(cleared["sheet-b"].notes?.notes, "두 번째 시트");
  assert.equal(second["sheet-a"].notes?.notes, "첫 시트");
});
