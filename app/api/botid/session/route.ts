import { NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import { nanoid } from "nanoid";
import {
  createBotIdSession,
  rateLimit,
  BOTID_SESSION_COOKIE_NAME,
  BOTID_SESSION_TTL_SECONDS,
} from "@/lib/redis";

export async function POST(request: Request) {
  const verification = await checkBotId();
  if (verification.isBot) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const limitResult = await rateLimit(`rate:botid:${ip}`, 60, 60);
  if (!limitResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const sessionId = nanoid(32);
  await createBotIdSession(sessionId);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(BOTID_SESSION_COOKIE_NAME, sessionId, {
    path: "/",
    maxAge: BOTID_SESSION_TTL_SECONDS,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  return response;
}
