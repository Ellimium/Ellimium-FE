import assert from "node:assert/strict";
import test from "node:test";
import { startMusicPreview } from "./preview.ts";

class AudioStub extends EventTarget {
  src = "";
  currentTime = 0;
  duration = 100;
  paused = true;
  plays = 0;
  async play() { this.paused = false; this.plays++; this.dispatchEvent(new Event("play")); }
  pause() { this.paused = true; }
  load() { this.currentTime = 0; this.paused = true; }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  loaded() { this.dispatchEvent(new Event("loadedmetadata")); }
}
const noError = (message: string) => { if (message) assert.fail(message); };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const url = (id: number, expiresIn = 2) => ({ signedUrl: `http://127.0.0.1:54321/music-${id}`, expiresIn });

test("재발급 요청 중 누른 재생은 중복 요청 없이 새 URL에서 재개된다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const audio = new AudioStub();
  let requests = 0;
  let resolve!: (value: ReturnType<typeof url>) => void;
  const pending = new Promise<ReturnType<typeof url>>((done) => { resolve = done; });
  const close = startMusicPreview(audio, () => ++requests === 1 ? Promise.resolve(url(1)) : pending, noError, () => {});
  await settle(); audio.loaded(); await settle();
  audio.pause(); audio.currentTime = 19;
  t.mock.timers.tick(2000); await settle();
  await audio.play(); await audio.play();
  assert.equal(audio.paused, true);
  assert.equal(requests, 2);
  resolve(url(2)); await settle(); audio.loaded(); await settle();
  assert.equal(audio.paused, false);
  assert.equal(audio.currentTime, 19);
  assert.equal(requests, 2);
  close();
});

test("재발급 중 재생을 요청해도 권한 거부 시에는 정지한다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const audio = new AudioStub();
  let requests = 0;
  let reject!: (error: Error) => void;
  const errors: string[] = [];
  const pending = new Promise<ReturnType<typeof url>>((_done, fail) => { reject = fail; });
  const close = startMusicPreview(audio, () => ++requests === 1 ? Promise.resolve(url(1)) : pending, (error) => errors.push(error), () => {});
  await settle(); audio.loaded(); await settle(); audio.pause();
  t.mock.timers.tick(2000); await settle(); await audio.play();
  reject(new Error("접근 권한이 없습니다.")); await settle(); audio.loaded(); await settle();
  assert.equal(audio.paused, true); assert.equal(audio.src, "");
  assert.deepEqual(errors.filter(Boolean), ["접근 권한이 없습니다."]);
  close();
});

test("만료 후 재발급은 재생 위치를 보존하며 권한 거부 시 재생을 종료한다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const audio = new AudioStub();
  let requests = 0;
  const errors: string[] = [];
  const close = startMusicPreview(audio, async () => {
    requests++;
    if (requests === 3) throw new Error("접근 권한이 없습니다.");
    return url(requests);
  }, (error) => errors.push(error), () => {});
  await settle(); audio.loaded(); await settle();
  assert.equal(audio.paused, false);
  audio.currentTime = 17;
  t.mock.timers.tick(2000); await settle(); audio.loaded(); await settle();
  assert.equal(requests, 2);
  assert.equal(audio.currentTime, 17);
  assert.equal(audio.paused, false);
  t.mock.timers.tick(2000); await settle();
  assert.equal(requests, 3);
  assert.equal(audio.paused, true);
  assert.equal(audio.src, "");
  assert.deepEqual(errors.filter(Boolean), ["접근 권한이 없습니다."]);
  t.mock.timers.tick(10000); await settle();
  assert.equal(requests, 3);
  close();
});

test("일시정지 상태에서 재발급하면 재생을 자동 재개하지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const audio = new AudioStub();
  const close = startMusicPreview(audio, async () => url(1), noError, () => {});
  await settle(); audio.loaded(); await settle();
  audio.pause(); audio.currentTime = 23;
  t.mock.timers.tick(2000); await settle(); audio.loaded(); await settle();
  assert.equal(audio.currentTime, 23);
  assert.equal(audio.paused, true);
  assert.equal(audio.plays, 1);
  close();
});

test("화면 이탈·곡 교체 후 도착한 응답은 오디오를 되살리지 않는다", async () => {
  const audio = new AudioStub();
  let resolve!: (value: ReturnType<typeof url>) => void;
  const pending = new Promise<ReturnType<typeof url>>((done) => { resolve = done; });
  const closeOld = startMusicPreview(audio, () => pending, noError, () => {});
  closeOld();
  const closeNew = startMusicPreview(audio, async () => url(2, 300), noError, () => {});
  await settle();
  resolve(url(1)); await settle();
  assert.equal(audio.src, url(2).signedUrl);
  closeNew();
  audio.loaded(); await settle();
  assert.equal(audio.paused, true);
  assert.equal(audio.src, "");
});

test("파일 로딩·디코딩 실패는 재생과 예약된 재발급을 정리한다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const audio = new AudioStub(); let requests = 0;
  const errors: string[] = [];
  const close = startMusicPreview(audio, async () => { requests++; return url(1); }, (error) => errors.push(error), () => {});
  await settle(); audio.dispatchEvent(new Event("error"));
  assert.match(errors[0], /디코딩/);
  assert.equal(audio.src, "");
  t.mock.timers.tick(10000); await settle();
  assert.equal(requests, 1);
  close();
});

test("유효하지 않은 URL 발급 응답은 재생하지 않는다", async () => {
  const audio = new AudioStub(); const errors: string[] = [];
  const close = startMusicPreview(audio, async () => ({ signedUrl: "javascript:alert(1)", expiresIn: 300 }), (error) => errors.push(error), () => {});
  await settle();
  assert.equal(audio.src, ""); assert.match(errors[0], /URL/);
  close();
});

test("발급 요청이 TTL보다 오래 걸리면 만료 응답을 사용하거나 재발급을 반복하지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const audio = new AudioStub(); const errors: string[] = [];
  let requests = 0;
  let resolve!: (value: ReturnType<typeof url>) => void;
  const pending = new Promise<ReturnType<typeof url>>((done) => { resolve = done; });
  const close = startMusicPreview(audio, () => { requests++; return pending; }, (error) => errors.push(error), () => {});
  t.mock.timers.tick(2000); resolve(url(1)); await settle();
  assert.equal(audio.src, ""); assert.match(errors[0], /URL/);
  t.mock.timers.tick(10000); await settle(); assert.equal(requests, 1);
  close();
});
