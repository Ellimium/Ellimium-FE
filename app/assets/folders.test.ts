import assert from "node:assert/strict";
import test from "node:test";
import { folderError, orderedFolders } from "./folders.ts";

test("폴더를 부모 아래에 배치하고 깊이를 유지한다", () => {
  const folders = [
    { id: "child", name: "A", parent_id: "root", depth: 2 },
    { id: "grandchild", name: "B", parent_id: "child", depth: 3 },
    { id: "other", name: "C", parent_id: null, depth: 1 },
    { id: "root", name: "D", parent_id: null, depth: 1 },
  ];
  assert.deepEqual(orderedFolders(folders).map(({ id, depth }) => [id, depth]), [
    ["other", 1], ["root", 1], ["child", 2], ["grandchild", 3],
  ]);
  assert.deepEqual(orderedFolders([]), []);
});

test("내용이 있는 폴더 삭제와 권한 거부를 구분해 안내한다", () => {
  assert.match(folderError("delete", "23503"), /먼저 자산을 옮기고/);
  assert.match(folderError("create", "23503"), /새로고침/);
  assert.match(folderError("rename", "42501"), /권한/);
  assert.match(folderError("delete", "PGRST116"), /없어졌습니다/);
});
