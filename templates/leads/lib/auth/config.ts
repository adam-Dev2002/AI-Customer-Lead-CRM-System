export function supabaseConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!url || !key || key.startsWith("sb_secret_")) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) return null;
    // A service-role JWT must never be used as a browser/session key.
    if (key.split(".").length === 3) {
      const payload = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role !== "anon") return null;
    }
    return { url: parsed.origin, key };
  } catch { return null; }
}

export function safeReturnPath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    // URL parsing normalizes dot segments and control characters before a browser
    // navigates. Check the normalized destination, including its origin.
    const parsed = new URL(value.slice(0, 1000), "https://workspace.invalid");
    if (parsed.origin !== "https://workspace.invalid" || ["/auth", "/login", "/api"].some(path => parsed.pathname.startsWith(path))) return "/";
    return parsed.pathname + parsed.search + parsed.hash;
  } catch { return "/"; }
}
