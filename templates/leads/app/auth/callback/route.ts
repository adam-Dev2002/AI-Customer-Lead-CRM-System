import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/auth/server";
import { safeReturnPath } from "@/lib/auth/config";
export async function GET(request: NextRequest) {
  const client = await supabaseServer();
  const code = request.nextUrl.searchParams.get("code");
  if (client && code) {
    const result = await client.auth.exchangeCodeForSession(code);
    if (!result.error) return NextResponse.redirect(new URL(safeReturnPath(request.nextUrl.searchParams.get("next")), request.url));
  }
  return NextResponse.redirect(new URL("/login?reason=link", request.url));
}
