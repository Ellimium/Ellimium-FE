import assert from "node:assert/strict";
import test from "node:test";

import { releaseSharedImages, sharedImageUrls } from "./shared-images.ts";

test("공유 이미지는 캐시 없이 사용자 인증으로 조회하고 Blob URL을 해제한다", async (t) => {
  const requests: { url: string; options: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    requests.push({ url, options });
    return new Response(new Blob(["image"]));
  });
  const revoked: string[] = [];
  t.mock.method(URL, "revokeObjectURL", (url: string) => revoked.push(url));
  const signal = new AbortController().signal;
  const urls = await sharedImageUrls(["owner/a #.png", "owner/a #.png", "owner/thumb.png"], "user-token", signal);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /object\/authenticated\/assets\/owner\/a%20%23.png$/);
  for (const request of requests) {
    assert.equal(request.options.cache, "no-store");
    assert.equal(request.options.signal, signal);
    assert.equal((request.options.headers as Record<string, string>).Authorization, "Bearer user-token");
  }
  assert.equal(urls.size, 2);
  assert.ok([...urls.values()].every((url) => url.startsWith("blob:")));
  releaseSharedImages(urls);
  assert.deepEqual(revoked, [...urls.values()]);
});

test("공유 해제 후 조회가 거부되면 이미지 URL을 생성하지 않는다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("denied", { status: 403 }));
  const create = t.mock.method(URL, "createObjectURL");
  await assert.rejects(sharedImageUrls(["owner/private.png"], "token", new AbortController().signal), /접근/);
  assert.equal(create.mock.callCount(), 0);
});

test("룸 전환으로 취소된 응답은 Blob URL로 남지 않는다", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return new Response(new Blob(["late image"]));
  });
  const create = t.mock.method(URL, "createObjectURL");
  await assert.rejects(sharedImageUrls(["owner/late.png"], "token", controller.signal), { name: "AbortError" });
  assert.equal(create.mock.callCount(), 0);
});
