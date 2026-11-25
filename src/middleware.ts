import { NextResponse, type NextRequest } from "next/server";

// Mirrors OPERATOR_COOKIE_NAME / verifyOperatorSession in lib/auth.ts (which can't run on the edge: it imports Prisma).
const COOKIE = "vigil_operator_session";

/** Reachable without a session: public status, signed ingest, demo services monitors probe, cron (own secret), login. */
function isPublic(path: string): boolean {
  if (path === "/api/sim/recover") return false; // mutates state, unlike the other demo services
  return (
    path === "/unlock" ||
    path === "/api/auth/operator" ||
    /^\/(status|api\/status|api\/ingest|api\/sim|api\/cron)(\/|$)/.test(path)
  );
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function validSession(token: string, secret: string): Promise<boolean> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  if (!constantTimeEqual(sig, expected)) return false;
  try {
    const parsed = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return parsed?.role === "operator" && typeof parsed.exp === "number" && parsed.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (isPublic(path)) return NextResponse.next();

  const secret = process.env.VIGIL_OPERATOR_SECRET;
  const isApi = path.startsWith("/api/");
  if (!secret) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next(); // zero-config local dev
    const message = "Operator secret (VIGIL_OPERATOR_SECRET) is not configured.";
    return isApi
      ? NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message } }, { status: 503 })
      : new NextResponse(message, { status: 503 });
  }

  const bearer = req.headers.get("authorization")?.match(/^bearer\s+(.+)$/i)?.[1]?.trim();
  const header = req.headers.get("x-operator-secret");
  const cookie = req.cookies.get(COOKIE)?.value;
  if (
    (bearer && constantTimeEqual(bearer, secret)) ||
    (header && constantTimeEqual(header, secret)) ||
    (cookie && (await validSession(cookie, secret)))
  ) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Operator authentication required." } }, { status: 401 });
  }
  const url = new URL("/unlock", req.url);
  url.searchParams.set("next", path + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except framework assets and the favicon.
  matcher: ["/((?!_next/|icon.svg|favicon.ico).*)"],
};
