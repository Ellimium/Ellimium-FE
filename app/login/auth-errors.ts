import { isAuthRetryableFetchError } from "@supabase/supabase-js";

export function getAuthErrorMessage(error: unknown): string {
  if (isAuthRetryableFetchError(error)) {
    return "인증 서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도하세요.";
  }

  if (typeof error === "object" && error !== null) {
    if ("status" in error && error.status === 429) {
      return "요청이 너무 많습니다. 잠시 기다린 뒤 다시 시도하세요.";
    }

    if ("code" in error) {
      switch (error.code) {
        case "invalid_credentials":
          return "이메일 또는 비밀번호를 확인하고 다시 시도하세요.";
        case "email_not_confirmed":
          return "이메일 확인이 필요합니다. 받은 확인 이메일의 링크를 연 뒤 다시 로그인하세요.";
        case "over_request_rate_limit":
        case "over_email_send_rate_limit":
          return "요청이 너무 많습니다. 잠시 기다린 뒤 다시 시도하세요.";
        case "weak_password":
          return "비밀번호가 보안 조건을 충족하지 않습니다. 더 안전한 비밀번호로 다시 시도하세요.";
        case "email_address_invalid":
          return "사용할 수 없는 이메일 주소입니다. 이메일 주소를 확인하고 다시 시도하세요.";
      }
    }
  }

  return "인증을 완료하지 못했습니다. 잠시 후 다시 시도하세요. 문제가 계속되면 관리자에게 문의하세요.";
}
