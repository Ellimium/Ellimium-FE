import assert from "node:assert/strict";
import test from "node:test";

import { getLoginHref, getSafeReturnPath } from "../login/return-path.ts";

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
