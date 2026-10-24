import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { supabaseConfiguration } from "@/lib/auth/config";
import { customerPageRedirect } from "@/lib/auth/customer-site";
import { isPublicInformationPage } from "@/lib/public-site";

export async function proxy(request: NextRequest) {
  const customerURL = customerPageRedirect(request.nextUrl, request.headers.get("host"), request.method);
  if (customerURL) {
    const redirect = NextResponse.redirect(customerURL, 307);
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }
  // Public product/policy pages do not read a session or any workspace data.
  // They remain available when the authentication provider is unavailable.
  if (isPublicInformationPage(request.nextUrl.pathname)) return NextResponse.next();
  let response = NextResponse.next({ request });
  const config = supabaseConfiguration();
  const publicPage = request.nextUrl.pathname === "/login" || request.nextUrl.pathname.startsWith("/auth/");
  if (!config) {
    if (publicPage) return response;
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const client = createServerClient(config.url, config.key, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(12000) }) },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: values => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  let signedIn = false;
  try { const result = await client.auth.getUser(); signedIn = !!result.data.user && !result.error; } catch {}
  if (!signedIn && !publicPage) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  // Automation endpoints retain their existing Bearer authentication. API routes verify owner access themselves.
  matcher: ["/((?!api|_next/static|_next/image|brand|integrations|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|pdf)$).*)"],
};
