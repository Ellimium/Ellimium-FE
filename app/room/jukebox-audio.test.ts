import assert from "node:assert/strict";
import test from "node:test";
import { emptyJukeboxAudio, jukeboxPosition, startJukeboxAudio, type JukeboxAudioView, type SignedJukeboxMusic } from "./jukebox-audio.ts";
import type { JukeboxState } from "./jukebox.ts";

const state: JukeboxState = { room_id: "r", music_asset_id: "a", status: "playing", position_ms: 1000,
  state_changed_at: "1970-01-01T00:00:00.000Z", loop_enabled: false };
const signed = (id = "a", expiresIn = 300) => ({ signedUrl: `http://127.0.0.1:54321/${id}`, expiresIn });
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
class AudioStub extends EventTarget {
  src = ""; currentTime = 0; duration = 10; paused = true; loop = false; volume = 1; muted = false; plays = 0;
  playError: Error | null = null;
  async play() { this.plays++; if (this.playError) throw this.playError; this.paused = false; }
  pause() { this.paused = true; }
  load() { this.currentTime = 0; this.paused = true; }
  removeAttribute(key: string) { if (key === "src") this.src = ""; }
  loaded() { this.dispatchEvent(new Event("loadedmetadata")); }
}
function setup(issue: (id: string) => Promise<SignedJukeboxMusic> = async (id) => signed(id)) {
  const audio = new AudioStub(); const views: JukeboxAudioView[] = []; let denied = 0;
  const engine = startJukeboxAudio(audio, issue, (view) => views.push(view), () => { denied++; });
  return { audio, engine, views, get view() { return views.at(-1) ?? emptyJukeboxAudio(); }, get denied() { return denied; } };
}
test("서버 경과 시간과 실제 파일 길이로 위치·반복·파일 끝을 계산한다", () => {
  assert.equal(jukeboxPosition(state, 10, 3000), 4);
  assert.equal(jukeboxPosition({ ...state, status: "paused" }, 10, 3000), 1);
  assert.equal(jukeboxPosition({ ...state, loop_enabled: true }, 3, 3000), 1);
  assert.equal(jukeboxPosition(state, 3, 3000), 3);
  assert.equal(jukeboxPosition(state, 10, -1000), 1);
  assert.equal(jukeboxPosition(state, Infinity, 3000), 0);
});
test("활성화 전에는 상태만 반영하고 메타데이터를 읽은 후 사용자가 재생한다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const h = setup(); h.engine.update(state); await settle();
  assert.equal(h.view.loading, true); assert.equal(h.view.duration, null); h.audio.loaded(); await settle();
  assert.equal(h.view.duration, 10);
  assert.equal(h.audio.plays, 0); assert.equal(h.audio.currentTime, 1); assert.equal(h.view.needsActivation, true);
  h.engine.activate(); await settle(); assert.equal(h.audio.paused, false); assert.equal(h.view.needsActivation, false); h.engine.dispose();
});
test("자동 재생 거부는 활성화를 다시 요구하고 상태 동기화는 유지한다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const h = setup(); h.engine.update(state); await settle(); h.audio.loaded();
  h.audio.playError = Object.assign(new Error("blocked"), { name: "NotAllowedError" });
  h.engine.activate(); await settle(); assert.equal(h.view.needsActivation, true); assert.match(h.view.error, /오디오 활성화/);
  h.engine.update({ ...state, position_ms: 5000 }); assert.equal(h.audio.currentTime, 5); assert.equal(h.audio.paused, true);
  h.audio.playError = null; h.engine.activate(); await settle(); assert.equal(h.audio.paused, false); h.engine.dispose();
});
test("일시 정지·재개·위치 이동·탭 복귀 보정은 파일을 다시 발급하지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 }); let requests = 0;
  const h = setup(async () => { requests++; return signed(); }); h.engine.update(state); await settle(); h.audio.loaded(); h.engine.activate(); await settle();
  h.engine.update({ ...state, status: "paused", position_ms: 4000 }); assert.equal(h.audio.paused, true); assert.equal(h.audio.currentTime, 4);
  h.engine.update({ ...state, position_ms: 6000 }); await settle(); assert.equal(h.audio.paused, false); assert.equal(h.audio.currentTime, 6);
  t.mock.timers.tick(1000); h.audio.currentTime = 1; h.engine.update({ ...state, position_ms: 6000 }); await settle();
  assert.equal(h.audio.currentTime, 7); assert.equal(requests, 1); h.engine.dispose();
});
test("한 곡 반복은 실제 길이를 사용하고 반복하지 않는 파일 끝은 재시작하지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 4000 });
  const h = setup(); h.audio.duration = 3; h.engine.update({ ...state, loop_enabled: true }); await settle(); h.audio.loaded(); h.engine.activate(); await settle();
  assert.equal(h.audio.currentTime, 2); assert.equal(h.audio.loop, true);
  h.engine.update(state); assert.equal(h.audio.currentTime, 3); assert.equal(h.audio.loop, false); assert.equal(h.audio.paused, true);
  const plays = h.audio.plays; h.audio.dispatchEvent(new Event("ended")); await settle(); assert.equal(h.audio.plays, plays); h.engine.dispose();
});
test("URL 만료 시 일시 정지하고 새 파일 로드 시 현재 서버 위치로 재개한다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 }); let requests = 0;
  const h = setup(async () => signed(String(++requests), 2)); h.engine.update(state); await settle(); h.audio.loaded(); h.engine.activate(); await settle();
  t.mock.timers.tick(2000); await settle(); assert.equal(requests, 2); assert.equal(h.audio.paused, true);
  h.audio.loaded(); await settle(); assert.equal(h.audio.currentTime, 3); assert.equal(h.audio.paused, false); h.engine.dispose();
});
test("퇴장 후 재발급 거부는 즉시 파일을 해제하고 룸 권한 재조회를 요청한다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 }); let requests = 0;
  const h = setup(async () => { if (++requests > 1) throw Object.assign(new Error("권한 거부"), { accessDenied: true }); return signed("a", 2); });
  h.engine.update(state); await settle(); h.audio.loaded(); h.engine.activate(); await settle(); t.mock.timers.tick(2000); await settle();
  assert.equal(h.audio.src, ""); assert.equal(h.audio.paused, true); assert.equal(h.denied, 1); assert.equal(h.view.error, "권한 거부"); assert.equal(h.view.duration, null); h.engine.dispose();
});
test("새 음악 선택 후 늦은 이전 URL 응답은 재생을 복원하지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 }); let resolve!: (data: SignedJukeboxMusic) => void;
  const old = new Promise<SignedJukeboxMusic>((done) => { resolve = done; });
  const h = setup((id) => id === "a" ? old : Promise.resolve(signed(id)));
  h.engine.update(state); h.engine.update({ ...state, music_asset_id: "b" }); await settle();
  h.audio.loaded(); h.engine.activate(); await settle(); resolve(signed("a")); await settle();
  assert.equal(h.audio.src, signed("b").signedUrl); assert.equal(h.audio.paused, false); h.engine.dispose();
});
test("정지·음악 삭제·퇴장·해제 중 진행 중인 URL 요청과 이벤트는 무시한다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  for (const next of [null, { ...state, status: "stopped" as const, music_asset_id: null }]) {
    let resolve!: (data: SignedJukeboxMusic) => void;
    const h = setup(() => new Promise((done) => { resolve = done; })); h.engine.update(state); h.engine.update(next);
    resolve(signed()); await settle(); h.audio.loaded(); assert.equal(h.audio.src, ""); assert.equal(h.audio.paused, true); assert.equal(h.view.duration, null); h.engine.dispose();
  }
  const h = setup(); h.engine.update(state); await settle(); h.audio.loaded(); h.engine.activate(); await settle();
  h.engine.dispose(); const count = h.views.length;
  h.engine.update(state); h.audio.dispatchEvent(new Event("error")); h.audio.loaded(); t.mock.timers.tick(300000); await settle();
  assert.equal(h.views.length, count); assert.equal(h.audio.src, "");
});
test("음량과 음소거는 기기에만 적용하며 음악을 바꿔도 유지한다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const h = setup(); h.engine.setVolume(0.3); h.engine.setMuted(true); h.engine.update(state); await settle(); h.audio.loaded();
  h.engine.update({ ...state, music_asset_id: "b" }); await settle(); h.audio.loaded();
  assert.equal(h.audio.volume, 0.3); assert.equal(h.audio.muted, true); assert.equal(h.view.volume, 0.3); assert.equal(h.view.muted, true);
  h.engine.setVolume(2); assert.equal(h.audio.volume, 1); h.engine.setVolume(NaN); assert.equal(h.audio.volume, 1); h.engine.dispose();
});
test("로딩·디코딩 오류는 파일을 해제하고 명시적 재시도로 복구한다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const h = setup(); h.engine.update(state); await settle(); h.audio.dispatchEvent(new Event("error"));
  assert.equal(h.audio.src, ""); assert.match(h.view.error, /디코딩/); h.engine.retry(); await settle(); h.audio.loaded();
  assert.equal(h.view.error, ""); assert.equal(h.view.loading, false); h.engine.dispose();
});
test("유효하지 않은 URL·만료 값·실제 재생 길이는 거부한다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  for (const data of [signed("a", 0), signed("a", 301), { signedUrl: "javascript:alert(1)", expiresIn: 2 }]) {
    const h = setup(async () => data); h.engine.update(state); await settle(); assert.equal(h.audio.src, ""); assert.notEqual(h.view.error, ""); h.engine.dispose();
  }
  const h = setup(); h.engine.update(state); await settle(); h.audio.duration = Infinity; h.audio.loaded();
  assert.match(h.view.error, /재생 시간/); assert.equal(h.audio.src, ""); h.engine.dispose();
});


test("진행 중 재생 요청을 일시 정지·재개하면 중단된 Promise 후 최신 상태로 재생한다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const h = setup(); h.engine.update(state); await settle(); h.audio.loaded();
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_done, fail) => { reject = fail; });
  h.audio.play = () => pending;
  h.engine.activate();
  h.engine.update({ ...state, status: "paused" });
  h.engine.update({ ...state, position_ms: 3000 });
  h.audio.play = AudioStub.prototype.play;
  reject(Object.assign(new Error("cancelled"), { name: "AbortError" })); await settle();
  assert.equal(h.audio.paused, false); assert.equal(h.audio.currentTime, 3); assert.equal(h.view.error, ""); h.engine.dispose();
});
