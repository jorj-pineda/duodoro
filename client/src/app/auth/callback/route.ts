import { NextRequest, NextResponse } from "next/server";
import { SITE_URL } from "@/lib/site";

function callbackOrigin(request: NextRequest): string {
  // Vercel supplies this deployment hostname; request/forwarding headers do
  // not establish trust. Production callbacks always use the canonical site.
  const previewHost = process.env.VERCEL_URL;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "preview" &&
      previewHost && previewHost.length <= 253 && /^[a-z0-9.-]+\.vercel\.app$/i.test(previewHost)) {
    return `https://${previewHost}`;
  }
  const incoming = new URL(request.url);
  if (process.env.NODE_ENV === "development" &&
      ["http:", "https:"].includes(incoming.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(incoming.hostname)) {
    return incoming.origin;
  }
  return SITE_URL;
}

// The browser exchanges this code using its PKCE verifier. The app resumes
// invitations from its existing local state, so there is no next destination
// to accept from the request.
export async function GET(request: NextRequest) {
  const destination = new URL("/", callbackOrigin(request));
  const code = request.nextUrl.searchParams.get("code");
  if (code) destination.searchParams.set("code", code);
  return NextResponse.redirect(destination, {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
