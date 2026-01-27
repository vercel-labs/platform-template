/**
 * Session API Route
 *
 * Creates a new session with an OIDC token stored in Redis.
 * The session ID is returned to the sandbox which uses it in place of the OIDC token.
 */

import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { createSession, updateSessionSandbox } from "@/lib/redis";

export const maxDuration = 10;

/**
 * POST /api/ai/session
 *
 * Creates a new session and stores the OIDC token in Redis.
 * Returns a session ID that can be used by the sandbox.
 */
export async function POST(request: Request) {
  try {

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

    // Store the session in Redis
    await createSession(sessionId, sandboxId);

    return NextResponse.json({
      sessionId,
      expiresIn: 3600, // 1 hour
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
