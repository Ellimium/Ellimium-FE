import assert from "node:assert/strict";
import test from "node:test";

import { validateUpload } from "./upload-validation.ts";

const png = (size: number) => ({ size, type: "image/png" });

test("업로드 형식과 카테고리별 용량을 검증한다", () => {
  assert.equal(validateUpload("map", png(10 * 1024 * 1024)), "");
  assert.match(validateUpload("map", png(10 * 1024 * 1024 + 1)), /10MB/);
  assert.match(validateUpload("token", png(5 * 1024 * 1024 + 1)), /5MB/);
  assert.match(validateUpload("item", { size: 1, type: "image/svg+xml" }), /JPEG/);
  assert.match(validateUpload("other", png(1), png(5 * 1024 * 1024 + 1)), /썸네일은 5MB/);
});
