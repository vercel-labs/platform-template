import { getSandboxSession } from "@/lib/chat-history";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSandboxSession(id);

  if (!session?.activeStreamId) {
    return new Response(null, { status: 204 });
  }

  const streamContext = createResumableStreamContext({ waitUntil: after });
  const resumedStream = await streamContext.resumeExistingStream(
    session.activeStreamId,
  );

  return new Response(resumedStream, { headers: UI_MESSAGE_STREAM_HEADERS });
}
