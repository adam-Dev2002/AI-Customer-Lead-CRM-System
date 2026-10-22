import { supabaseConfiguration } from "./config.ts";

// Check before signUp so a project still requiring confirmation never sends a
// signup email or creates an account with a flow this application won't open.
export async function immediateSignupPolicy(request: typeof fetch = fetch): Promise<"ready" | "confirmation-required" | "disabled" | "unavailable"> {
  const config = supabaseConfiguration();
  if (!config) return "unavailable";
  try {
    const response = await request(config.url + "/auth/v1/settings", {
      headers: { apikey: config.key }, cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return "unavailable";
    const settings = await response.json();
    if (settings.disable_signup === true || settings.external?.email === false) return "disabled";
    if (settings.disable_signup !== false || settings.external?.email !== true || typeof settings.mailer_autoconfirm !== "boolean") return "unavailable";
    return settings.mailer_autoconfirm ? "ready" : "confirmation-required";
  } catch { return "unavailable"; }
}
