import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { Vercel } from "@vercel/sdk";
import { getSessionFromCookie, SESSION_COOKIE_NAME } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const deploymentId = searchParams.get("deploymentId");

  if (!deploymentId) {
    return new Response("Missing deploymentId", { status: 400 });
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSessionFromCookie(sessionCookie);

  if (!session?.tokens?.accessToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const vercel = new Vercel({
    bearerToken: session.tokens.accessToken,
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastSerial = "";
      let isComplete = false;

      const poll = async () => {
        try {
          const deployment = await vercel.deployments.getDeployment({
            idOrUrl: deploymentId,
          });

          const readyState = deployment.readyState;

          if (readyState === "READY" || readyState === "ERROR" || readyState === "CANCELED") {
            isComplete = true;
          }

          const events = await vercel.deployments.getDeploymentEvents({
            idOrUrl: deploymentId,
            direction: "forward",
            limit: -1,
            builds: 1,
          });

          if (Array.isArray(events)) {
            for (const event of events) {
              if (!event) continue;

              const serial =
                "serial" in event
                  ? event.serial
                  : "payload" in event
                    ? event.payload.serial
                    : null;

              if (serial && serial <= lastSerial) continue;
              if (serial) lastSerial = serial;

              const type = event.type;
              const text =
                "text" in event
                  ? event.text
                  : "payload" in event
                    ? event.payload.text
                    : null;

              if (
                text &&
                (type === "stdout" || type === "stderr" || type === "command")
              ) {
                const logLine =
                  JSON.stringify({
                    type,
                    text,
                    timestamp: Date.now(),
                  }) + "\n";
                controller.enqueue(encoder.encode(logLine));
              }

              if (type === "deployment-state") {
                const info =
                  "info" in event
                    ? event.info
                    : "payload" in event
                      ? event.payload.info
                      : null;
                if (info?.readyState) {
                  const stateLine =
                    JSON.stringify({
                      type: "state",
                      readyState: info.readyState,
                      timestamp: Date.now(),
                    }) + "\n";
                  controller.enqueue(encoder.encode(stateLine));

                  if (
                    info.readyState === "READY" ||
                    info.readyState === "ERROR" ||
                    info.readyState === "CANCELED"
                  ) {
                    isComplete = true;
                  }
                }
              }
            }
          }

          if (isComplete) {
            const doneLine = JSON.stringify({
              type: "done",
              readyState: readyState,
              timestamp: Date.now(),
            }) + "\n";
            controller.enqueue(encoder.encode(doneLine));
            controller.close();
            return;
          }

          setTimeout(poll, 1000);
        } catch (error) {
          console.error("[deploy/logs] Error polling events:", error);
          const errorLine = JSON.stringify({
            type: "error",
            message: error instanceof Error ? error.message : "Unknown error",
            timestamp: Date.now(),
          }) + "\n";
          controller.enqueue(encoder.encode(errorLine));
          controller.close();
        }
      };

      poll();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
