import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/auth/server";
export async function GET(request: NextRequest) {
  const client = await supabaseServer();
  const token_hash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  if (client && (type === "invite" || type === "recovery" || type === "signup")) {
    const code = request.nextUrl.searchParams.get("code");
    const result = token_hash ? await client.auth.verifyOtp({ token_hash, type }) : type === "signup" && code ? await client.auth.exchangeCodeForSession(code) : null;
    if (result && !result.error) {
      if (type === "signup") {
        await client.auth.signOut({ scope: "local" });
        return NextResponse.redirect(new URL("/login?reason=confirmed", request.url));
      }
      return NextResponse.redirect(new URL("/update-password", request.url));
    }
  }
  return NextResponse.redirect(new URL("/login?reason=link", request.url));
}
