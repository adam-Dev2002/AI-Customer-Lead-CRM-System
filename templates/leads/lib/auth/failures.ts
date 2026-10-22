export type AuthAction = "login" | "signup" | "reset" | "password" | "logout";
export type AuthFailureCode = "AUTH_CONFIGURATION" | "AUTH_WORKSPACE_SETUP" | "AUTH_EMAIL_SETUP" | "AUTH_SIGNUP_DISABLED" | "AUTH_RATE_LIMIT" | "AUTH_WEAK_PASSWORD" | "AUTH_UNAVAILABLE";

export function authFailureMessage(action: AuthAction, code: AuthFailureCode) {
  if (code === "AUTH_RATE_LIMIT") return "Too many attempts. Please wait a few minutes and try again.";
  if (code === "AUTH_WEAK_PASSWORD") return "Choose a stronger password with at least 10 characters.";
  if (code === "AUTH_EMAIL_SETUP") return action === "reset"
    ? "Password reset emails are not available yet. Please contact support."
    : "Account confirmation emails are not available yet. Please contact support.";
  if (code === "AUTH_WORKSPACE_SETUP" || code === "AUTH_SIGNUP_DISABLED") return "Account creation is being set up. Please contact support.";
  if (code === "AUTH_CONFIGURATION") return "Account access is temporarily unavailable. Please contact support.";
  if (action === "signup") return "Could not create your account right now. Please try again later or contact support.";
  if (action === "reset") return "Could not request a password reset right now. Please try again later or contact support.";
  if (action === "password") return "Could not update your password. Please try again later.";
  if (action === "logout") return "Could not sign out. Please try again.";
  return "Could not sign you in right now. Please try again later or contact support.";
}

export function authProviderFailure(error: { code?: string; status?: number }) {
  if (error.code === "email_address_not_authorized" || error.code === "email_provider_disabled") return "AUTH_EMAIL_SETUP" as const;
  if (error.code === "signup_disabled") return "AUTH_SIGNUP_DISABLED" as const;
  if (error.status === 429) return "AUTH_RATE_LIMIT" as const;
  if (error.code === "weak_password") return "AUTH_WEAK_PASSWORD" as const;
  return "AUTH_UNAVAILABLE" as const;
}
