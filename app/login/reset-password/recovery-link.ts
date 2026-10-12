export function getRecoveryTokens(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (params.has("error") || params.has("error_code") || params.has("error_description") ||
    params.get("type") !== "recovery" || !access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}
