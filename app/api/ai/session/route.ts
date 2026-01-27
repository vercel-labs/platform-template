/**
 * Session API Route
 *
 * Creates a new session stored in Redis.
 * If the user is authenticated, their user ID is stored in the session
 * so the proxy can use their AI gateway credits.
 */

import { NextResponse, type NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { createSession, updateSessionSandbox } from "@/lib/redis";
import { getSessionFromRequest } from "@/lib/auth";

export const maxDuration = 10;

/**
 * POST /api/ai/session
 *
 * Creates a new session. If the user is authenticated (has a valid auth cookie),
 * their user ID is stored in the session for AI gateway billing.
 */
export async function POST(request: NextRequest) {
  try {
    // Check if user is authenticated
    const authSession = await getSessionFromRequest(request);
    const userId = authSession?.user?.id;

    // Parse request body for optional sandbox ID
    let sandboxId: string | undefined;
    try {
      const body = await request.json();
      sandboxId = body.sandboxId;
    } catch {
      // No body or invalid JSON - that's fine
    }

    // Generate a unique session ID
    const sessionId = nanoid(32);

    // Store the session in Redis (with user ID if authenticated)
    await createSession(sessionId, { sandboxId, userId });

    return NextResponse.json({
      sessionId,
      expiresIn: 3600, // 1 hour
      authenticated: !!userId,
    });
  } catch (error) {
    console.error("[session] Error creating session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/ai/session
 *
 * Updates an existing session with a sandbox ID.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { sessionId, sandboxId } = body;

    if (!sessionId || !sandboxId) {
      return NextResponse.json(
        { error: "Missing sessionId or sandboxId" },
        { status: 400 }
      );
    }

    const updated = await updateSessionSandbox(sessionId, sandboxId);

    if (!updated) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[session] Error updating session:", error);
    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 }
    );
  }
}
