export function safeGoogleReturn(requested, origin) {
  try {
    const target = new URL(requested || "/", origin);
    return target.origin === origin ? `${target.pathname}${target.search}${target.hash}` : "/";
  } catch {
    return "/";
  }
}

export function googleReturnWithAuth(path, result) {
  const safe = typeof path === "string" && path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return `${safe}${safe.includes("?") ? "&" : "?"}auth=${encodeURIComponent(result)}`;
}
