import assert from "node:assert/strict";
import test from "node:test";

import { assetImagePaths, assetLabels, shortIds } from "./asset-images.ts";

test("썸네일 없는 모든 카테고리는 원본 미리보기를 조회하고 맵 결과와 경로를 중복 조회하지 않는다", () => {
  assert.deepEqual(assetImagePaths([
    { id: "map", category: "map", storage_path: "map.png", thumbnail_storage_path: null, created_at: "" },
    { id: "token", category: "token", storage_path: "token.png", thumbnail_storage_path: "thumb.png", created_at: "" },
    { id: "item", category: "item", storage_path: "item.png", thumbnail_storage_path: null, created_at: "" },
    { id: "other", category: "other", storage_path: "other.png", thumbnail_storage_path: null, created_at: "" },
  ]), ["map.png", "thumb.png", "item.png", "other.png"]);
});

test("같은 카테고리와 ID 접두사가 겹쳐도 자산 표시를 구분한다", () => {
  const assets = [
    { id: "12345678-aaaa", category: "token" as const },
    { id: "12345678-abbb", category: "token" as const },
    { id: "87654321-long-identifier", category: "map" as const },
  ];
  const labels = assetLabels(assets);
  assert.equal(new Set(labels.values()).size, 3);
  assert.equal(labels.get(assets[0].id), "토큰 · 12345678-aa");
  assert.equal(labels.get(assets[2].id), "맵 · 87654321");
  assert.deepEqual(assetLabels([...assets].reverse()), new Map([...labels].reverse()));
});


test("같은 자산의 서로 다른 맵 등록은 긴 접두사 충돌과 중복 입력에도 구분한다", () => {
  const first = "70707070-aaaa-4000-8000-000000000001";
  const second = "70707070-aaaa-4000-8000-000000000002";
  const labels = shortIds([first, second, first]);
  assert.equal(labels.size, 2);
  assert.notEqual(labels.get(first), labels.get(second));
});
