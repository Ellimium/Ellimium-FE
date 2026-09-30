export function getLoginHref(code: string) {
  const returnTo = `/room/join${code ? `?code=${encodeURIComponent(code)}` : ""}`;
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function getSafeReturnPath(returnTo: string | null) {
  if (!returnTo?.startsWith("/") || returnTo.startsWith("//")) return "/";

  try {
    const url = new URL(returnTo, "http://localhost");
    return url.origin === "http://localhost" ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
