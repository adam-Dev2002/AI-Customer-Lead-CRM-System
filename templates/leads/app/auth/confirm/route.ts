import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/auth/server";
export async function GET(request: NextRequest) {
  const client = await supabaseServer();
  const token_hash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  if (client && token_hash && (type === "invite" || type === "recovery")) {
    const result = await client.auth.verifyOtp({ token_hash, type });
    if (!result.error) return NextResponse.redirect(new URL("/update-password", request.url));
  }
  return NextResponse.redirect(new URL("/login?reason=link", request.url));
}
