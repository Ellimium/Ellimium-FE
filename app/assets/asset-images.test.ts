import assert from "node:assert/strict";
import test from "node:test";

import { assetImagePaths } from "./asset-images.ts";

test("썸네일과 맵 결과에 필요한 이미지만 조회한다", () => {
  assert.deepEqual(assetImagePaths([
    { id: "map", category: "map", storage_path: "map.png", thumbnail_storage_path: null, created_at: "" },
    { id: "token", category: "token", storage_path: "token.png", thumbnail_storage_path: "thumb.png", created_at: "" },
    { id: "other", category: "other", storage_path: "other.png", thumbnail_storage_path: null, created_at: "" },
  ]), ["map.png", "thumb.png"]);
});
