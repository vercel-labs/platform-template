import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { createSession, updateSessionSandbox } from "@/lib/redis";

export const maxDuration = 10;

export async function POST(request: Request) {
  try {
    let sandboxId: string | undefined;
    try {
      const body = await request.json();
      sandboxId = body.sandboxId;
    } catch {}

    const sessionId = nanoid(32);

    await createSession(sessionId, { sandboxId });

    return NextResponse.json({
      sessionId,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error("[session] Error creating session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { sessionId, sandboxId } = body;

    if (!sessionId || !sandboxId) {
      return NextResponse.json(
        { error: "Missing sessionId or sandboxId" },
        { status: 400 },
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
      { status: 500 },
    );
  }
}
