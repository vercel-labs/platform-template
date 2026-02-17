import { RPCHandler } from "@orpc/server/fetch";
import { onError } from "@orpc/server";
import type { NextRequest } from "next/server";
import { router } from "@/lib/rpc/router";
import { customJsonSerializers } from "@/lib/rpc/result-serializer";
import { BOTID_SESSION_COOKIE_NAME, isBotIdSessionValid } from "@/lib/redis";

export const maxDuration = 300;

const handler = new RPCHandler(router, {
  customJsonSerializers,
  interceptors: [
    onError((error) => {
      console.error(
        "[rpc] Error:",
        error instanceof Error ? error.message : error,
        error instanceof Error ? error.stack : "",
      );
    }),
  ],
});

async function handleRequest(request: NextRequest) {
  const url = new URL(request.url);
  console.log(`[rpc] ${request.method} ${url.pathname}`);

  const botIdSession = request.cookies.get(BOTID_SESSION_COOKIE_NAME)?.value;
  if (!botIdSession || !(await isBotIdSessionValid(botIdSession))) {
    return new Response("BotID session required", { status: 403 });
  }

  const { response } = await handler.handle(request, {
    prefix: "/rpc",
    context: {},
  });

  if (response) {
    console.log(`[rpc] ${url.pathname} -> ${response.status}`);
  }

  return response ?? new Response("Not found", { status: 404 });
}

export const HEAD = handleRequest;
export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
