import type { NextRequest } from "next/server";
import {
  VERCEL_OAUTH,
  isRelativeUrl,
  getSessionFromRequest,
  saveSession,
  CSRF_COOKIE_NAME,
  serializeCookie,
} from "@/lib/auth";

export async function POST(req: NextRequest): Promise<Response> {
  const csrfHeader = req.headers.get("x-csrf-token");
  const csrfCookie = req.cookies.get(CSRF_COOKIE_NAME)?.value;

  if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
    return new Response("Invalid CSRF token", { status: 403 });
  }

  const session = await getSessionFromRequest(req);

  if (session) {
    try {
      await fetch(VERCEL_OAUTH.revoke, {
        method: "POST",
        body: new URLSearchParams({ token: session.tokens.accessToken }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(
            `${process.env.VERCEL_CLIENT_ID}:${process.env.VERCEL_CLIENT_SECRET}`,
          ).toString("base64")}`,
        },
      });
    } catch (error) {
      console.error("[auth] Failed to revoke token:", error);
    }
  }

  let redirectUrl = "/";
  try {
    const body = await req.json();
    const next = typeof body?.next === "string" ? body.next : "/";
    redirectUrl = isRelativeUrl(next) ? next : "/";
  } catch {
    redirectUrl = "/";
  }

  const response = Response.json({ url: redirectUrl });

  response.headers.append(
    "Set-Cookie",
    serializeCookie(CSRF_COOKIE_NAME, "", {
      expires: new Date(0),
      path: "/",
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    }),
  );

  await saveSession(response, undefined);

  return response;
}
