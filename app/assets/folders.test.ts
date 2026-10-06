import assert from "node:assert/strict";
import test from "node:test";
import { assetMoveError, assetsInFolder, folderError, orderedFolders } from "./folders.ts";

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

test("미분류와 각 폴더의 자산을 분리하고 저장된 이동 결과를 반영한다", () => {
  const assets = [
    { id: "unclassified", folder_id: null },
    { id: "first", folder_id: "A" },
    { id: "second", folder_id: "B" },
  ];
  assert.deepEqual(assetsInFolder(assets, "").map(({ id }) => id), ["unclassified"]);
  assert.deepEqual(assetsInFolder(assets, "A").map(({ id }) => id), ["first"]);
  assets[1].folder_id = "B";
  assert.deepEqual(assetsInFolder(assets, "A"), []);
  assert.deepEqual(assetsInFolder(assets, "B").map(({ id }) => id), ["first", "second"]);
  assets[1].folder_id = null;
  assert.deepEqual(assetsInFolder(assets, "").map(({ id }) => id), ["unclassified", "first"]);
});

test("이동 실패 시 권한 거부와 없어진 목적지를 안내한다", () => {
  assert.match(assetMoveError("42501"), /권한/);
  assert.match(assetMoveError("PGRST116"), /없어졌습니다/);
  assert.match(assetMoveError("23503"), /폴더 목록을 새로고침/);
  assert.match(assetMoveError(), /다시 시도/);
});

test("내용이 있는 폴더 삭제와 권한 거부를 구분해 안내한다", () => {
  assert.match(folderError("delete", "23503"), /먼저 자산을 옮기고/);
  assert.match(folderError("create", "23503"), /새로고침/);
  assert.match(folderError("rename", "42501"), /권한/);
  assert.match(folderError("delete", "PGRST116"), /없어졌습니다/);
});
