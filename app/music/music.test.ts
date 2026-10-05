import assert from "node:assert/strict";
import test from "node:test";
import { musicDuration, musicFormat, musicSize, musicUploadBody, musicUploadError } from "./music.ts";

test("음악 업로드는 제목을 정리하고 원본 바이트와 파일 이름을 보존한다", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  for (const [name, type, expected] of [
    ["song.MP3", "audio/mpeg", "audio/mpeg"],
    ["song.ogg", "application/ogg", "audio/ogg"],
    ["song.wav", "audio/x-wav", "audio/wav"],
    ["song.mp3", "", "audio/mpeg"],
  ]) {
    const body = musicUploadBody("  전투 음악  ", new File([bytes], name, { type }));
    assert.equal(body.get("title"), "전투 음악");
    const file = body.get("file") as File;
    assert.equal(file.name, name);
    assert.equal(file.type, expected);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
    assert.equal(body.has("owner_id"), false);
    assert.equal(body.has("duration_ms"), false);
  }
});

test("빈 제목·파일과 지원하지 않는 확장자·MIME 불일치를 거부한다", () => {
  assert.throws(() => musicUploadBody("  ", new File(["x"], "song.mp3")), /제목/);
  assert.throws(() => musicUploadBody("음악", new File([], "song.mp3")), /비어/);
  assert.throws(() => musicUploadBody("음악", new File(["x"], "song.flac")), /MP3/);
  assert.throws(() => musicUploadBody("음악", new File(["x"], "song.constructor")), /MP3/);
  assert.throws(() => musicUploadBody("음악", new File(["x"], "song.wav", { type: "audio/mpeg" })), /일치/);
});

test("브라우저에서 별도 파일 크기 상한을 적용하지 않는다", () => {
  const file = new File([new Uint8Array(11 * 1024 * 1024)], "song.mp3", { type: "audio/mpeg" });
  assert.equal((musicUploadBody("음악", file).get("file") as File).size, file.size);
});

test("밀리초 재생 시간을 분·초로 표시하고 크기와 형식을 표시한다", () => {
  assert.equal(musicDuration(999), "0:00");
  assert.equal(musicDuration(61001), "1:01");
  assert.equal(musicDuration(3600000), "60:00");
  assert.equal(musicSize(12), "12 B");
  assert.equal(musicSize(1024), "1.0 KB");
  assert.equal(musicSize(1048576), "1.0 MB");
  assert.equal(musicFormat("audio/mpeg"), "MP3");
  assert.equal(musicFormat("audio/ogg"), "OGG");
  assert.equal(musicFormat("audio/x-wav"), "WAV");
});

test("BE 실패 유형을 구분하고 실패 정리가 필요한 경우를 명시한다", () => {
  assert.match(musicUploadError(401, null), /로그인/);
  assert.match(musicUploadError(413, { code: "storage_size_limit" }), /용량/);
  assert.match(musicUploadError(400, { code: "invalid_music_file", error: "audio file is invalid or cannot be decoded" }), /디코딩/);
  assert.match(musicUploadError(400, { code: "invalid_music_file" }), /형식/);
  assert.match(musicUploadError(500, { code: "metadata_save_failed" }), /정보/);
  assert.match(musicUploadError(502, { code: "storage_upload_failed" }), /거부/);
  assert.match(musicUploadError(500, { code: "cleanup_failed" }), /관리자/);
  assert.match(musicUploadError(500, null), /다시/);
});
