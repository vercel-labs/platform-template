/**
 * Auth Info Route
 *
 * GET /api/auth/info
 *
 * Returns the current user's session info.
 * Refreshes session data from Vercel API on each request.
 */

import type { NextRequest } from "next/server";
import type { Session, SessionUserInfo } from "@/lib/auth";
import { createSession, saveSession, getSessionFromRequest } from "@/lib/auth";

export async function GET(req: NextRequest): Promise<Response> {
  // Get existing session and refresh user data
  const existingSession = await getSessionFromRequest(req);
  const session = existingSession
    ? await createSession(existingSession.tokens)
    : undefined;

  const data: SessionUserInfo = {
    user: session?.user,
  };

  const response = new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });

  // Update the session cookie with refreshed data
  await saveSession(response, session);

  return response;
}
