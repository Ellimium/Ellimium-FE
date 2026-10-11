export function getLoginHref(code: string) {
  const returnTo = `/room/join${code ? `?code=${encodeURIComponent(code)}` : ""}`;
  return getLoginHrefForPath(returnTo);
}

export function getLoginHrefForPath(path: string) {
  return `/login?returnTo=${encodeURIComponent(getSafeReturnPath(path))}`;
}

export function getSafeReturnPath(returnTo: string | null) {
  if (!returnTo?.startsWith("/") || returnTo.startsWith("//")) return "/";

  try {
    const url = new URL(returnTo, "http://localhost");
    const pathname = decodeURIComponent(url.pathname).replace(/\\/g, "/");
    if (url.origin !== "http://localhost" || pathname.startsWith("//") || /^\/login(?:\/|$)/i.test(pathname)) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
