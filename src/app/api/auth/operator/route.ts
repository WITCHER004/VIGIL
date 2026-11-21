import { ApiError, handler, json, readJson } from "@/lib/api";
import { createOperatorSession, OPERATOR_COOKIE_NAME, safeCompare, verifyOperatorAuth } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const operatorLoginSchema = z.object({
  secret: z.string().min(1, "Secret is required"),
});

/**
 * POST /api/auth/operator — Authenticates operator and sets HttpOnly session cookie.
 */
export const POST = handler(async (req: Request) => {
  const serverSecret = process.env.VIGIL_OPERATOR_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (isProd && !serverSecret) {
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "VIGIL_OPERATOR_SECRET is not configured on this server.");
  }

  const { secret } = await readJson(req, operatorLoginSchema);

  if (serverSecret && !safeCompare(secret, serverSecret)) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid operator secret.");
  }

  const sessionToken = createOperatorSession(serverSecret || "vigil-local-dev-operator-key");
  const cookieValue = `${OPERATOR_COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${
    isProd ? "; Secure" : ""
  }`;

  return json(
    { ok: true, message: "Operator authenticated successfully." },
    {
      headers: {
        "Set-Cookie": cookieValue,
      },
    },
  );
});

/**
 * GET /api/auth/operator — Checks if the current session has valid operator credentials.
 */
export const GET = handler(async (req: Request) => {
  try {
    await verifyOperatorAuth(req);
    return json({ authenticated: true });
  } catch {
    return json({ authenticated: false });
  }
});

/**
 * DELETE /api/auth/operator — Clears operator session cookie.
 */
export const DELETE = handler(async () => {
  return json(
    { ok: true, message: "Operator logged out." },
    {
      headers: {
        "Set-Cookie": `${OPERATOR_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      },
    },
  );
});
