import type { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import type { SessionUserInfo } from "@/lib/auth";
import {
  createSession,
  saveSession,
  getSessionFromRequest,
  CSRF_COOKIE_NAME,
  CSRF_COOKIE_TTL_SECONDS,
  serializeCookie,
} from "@/lib/auth";

export async function GET(req: NextRequest): Promise<Response> {
  const existingSession = await getSessionFromRequest(req);
  const session = existingSession
    ? await createSession(existingSession.tokens)
    : undefined;

  const existingCsrf = req.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfToken = existingCsrf ?? randomBytes(32).toString("hex");

  const data: SessionUserInfo = {
    user: session?.user,
    csrfToken,
  };

  const response = new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });

  if (!existingCsrf) {
    response.headers.append(
      "Set-Cookie",
      serializeCookie(CSRF_COOKIE_NAME, csrfToken, {
        path: "/",
        maxAge: CSRF_COOKIE_TTL_SECONDS,
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      }),
    );
  }

  await saveSession(response, session);

  return response;
}
