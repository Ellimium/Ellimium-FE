import assert from "node:assert/strict";
import test from "node:test";

import { getLoginHref, getLoginHrefForPath, getSafeReturnPath } from "../login/return-path.ts";

test("returns to the invite after login while rejecting external destinations", () => {
  const loginUrl = new URL(getLoginHref("invite / code"), "http://localhost");

  assert.equal(
    getSafeReturnPath(loginUrl.searchParams.get("returnTo")),
    "/room/join?code=invite%20%2F%20code",
  );
  assert.equal(getSafeReturnPath(null), "/");
  assert.equal(getSafeReturnPath("https://example.com/room/join"), "/");
  assert.equal(getSafeReturnPath("//example.com/room/join"), "/");
  assert.equal(getSafeReturnPath("/\\example.com/room/join"), "/");
});

test("preserves an internal room path, query and hash through login", () => {
  const path = "/room?roomId=room-74&name=%ED%85%8C%EC%8A%A4%ED%8A%B8&value=a%26b#chat";
  const loginUrl = new URL(getLoginHrefForPath(path), "http://localhost");

  assert.equal(loginUrl.pathname, "/login");
  assert.equal(loginUrl.searchParams.get("returnTo"), path);
  assert.equal(getSafeReturnPath(loginUrl.searchParams.get("returnTo")), path);
});

test("falls back to the lobby for unsafe, malformed or repeating destinations", () => {
  const paths = [
    "", "room?roomId=74", "https://example.com/room", "//example.com/room",
    "/\\example.com/room", "/room/..//example.com/room", "/%2Fexample.com/room",
    "/%5Cexample.com/room", "/%",
    "/login", "/login?returnTo=%2Froom", "/login/", "/login/again",
    "/room/../login", "/%6cogin", "/LOGIN",
  ];

  for (const path of paths) {
    assert.equal(getSafeReturnPath(path), "/", path);
    const loginUrl = new URL(getLoginHrefForPath(path), "http://localhost");
    assert.equal(loginUrl.searchParams.get("returnTo"), "/", path);
  }
  assert.equal(getSafeReturnPath(null), "/");
});

test("keeps ordinary login and invite destinations available", () => {
  assert.equal(getSafeReturnPath(null), "/");
  assert.equal(getSafeReturnPath("/"), "/");
  assert.equal(getSafeReturnPath("/profile?tab=account"), "/profile?tab=account");
  assert.equal(getSafeReturnPath("/login-help"), "/login-help");
  assert.equal(getSafeReturnPath("/room?value=%"), "/room?value=%");
  const loginUrl = new URL(getLoginHref(""), "http://localhost");
  assert.equal(getSafeReturnPath(loginUrl.searchParams.get("returnTo")), "/room/join");
});
