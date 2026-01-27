
import type { NextRequest } from "next/server";
import {
  VERCEL_OAUTH,
  isRelativeUrl,
  getSessionFromRequest,
  saveSession,
} from "@/lib/auth";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSessionFromRequest(req);

  if (session) {
    try {
      await fetch(VERCEL_OAUTH.revoke, {
        method: "POST",
        body: new URLSearchParams({ token: session.tokens.accessToken }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(
            `${process.env.VERCEL_CLIENT_ID}:${process.env.VERCEL_CLIENT_SECRET}`
          ).toString("base64")}`,
        },
      });
    } catch (error) {
      console.error("[auth] Failed to revoke token:", error);
    }
  }

  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const redirectUrl = isRelativeUrl(next) ? next : "/";

  const response = Response.json({ url: redirectUrl });

  await saveSession(response, undefined);

  return response;
}
