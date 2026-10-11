import assert from "node:assert/strict";
import test from "node:test";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";

import { getAuthErrorMessage } from "./auth-errors.ts";

test("explains invalid credentials without identifying which credential is wrong", () => {
  assert.equal(
    getAuthErrorMessage(new AuthApiError("Invalid login credentials", 400, "invalid_credentials")),
    "이메일 또는 비밀번호를 확인하고 다시 시도하세요.",
  );
});

test("asks users to confirm their email before retrying login", () => {
  assert.equal(
    getAuthErrorMessage(new AuthApiError("Email not confirmed", 400, "email_not_confirmed")),
    "이메일 확인이 필요합니다. 받은 확인 이메일의 링크를 연 뒤 다시 로그인하세요.",
  );
});

test("asks users to wait on rate limit codes and HTTP 429 without a known code", () => {
  for (const code of ["over_request_rate_limit", "over_email_send_rate_limit", "future_limit", undefined]) {
    assert.equal(
      getAuthErrorMessage(new AuthApiError("Too many requests", 429, code)),
      "요청이 너무 많습니다. 잠시 기다린 뒤 다시 시도하세요.",
    );
  }
  assert.match(getAuthErrorMessage(new AuthApiError("Limit", 400, "over_email_send_rate_limit")), /잠시 기다린/);
  assert.match(getAuthErrorMessage(new AuthApiError("Limit", 400, "over_request_rate_limit")), /잠시 기다린/);
});

test("handles returned SDK network errors and temporary server failures", () => {
  for (const status of [0, 502, 503, 504]) {
    assert.equal(
      getAuthErrorMessage(new AuthRetryableFetchError("Failed to fetch", status)),
      "인증 서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도하세요.",
    );
  }
});

test("guides signup input corrections", () => {
  assert.match(getAuthErrorMessage(new AuthApiError("Weak password", 422, "weak_password")), /더 안전한 비밀번호/);
  assert.match(getAuthErrorMessage(new AuthApiError("Invalid email", 422, "email_address_invalid")), /이메일 주소를 확인/);
});

test("unknown and account existence errors share a safe fallback without raw messages", () => {
  const fallback = "인증을 완료하지 못했습니다. 잠시 후 다시 시도하세요. 문제가 계속되면 관리자에게 문의하세요.";
  const errors = [
    new AuthApiError("Account exists: private@example.com", 422, "user_already_exists"),
    new AuthApiError("Account exists: private@example.com", 422, "email_exists"),
    new AuthApiError("User not found", 400, "user_not_found"),
    new AuthApiError("Internal implementation details", 500, "unexpected_failure"),
    new AuthApiError("Invalid login credentials", 400, undefined),
    new Error("Internal implementation details"),
    null, undefined, "Failed to fetch", {},
  ];

  for (const error of errors) {
    assert.equal(getAuthErrorMessage(error), fallback);
  }
});
