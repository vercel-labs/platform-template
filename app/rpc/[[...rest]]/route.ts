import { RPCHandler } from "@orpc/server/fetch";
import { onError } from "@orpc/server";
import { router } from "@/lib/rpc/router";
import { customJsonSerializers } from "@/lib/rpc/result-serializer";

export const maxDuration = 300;

const handler = new RPCHandler(router, {
  customJsonSerializers,
  interceptors: [
    onError((error) => {
      console.error("RPC Error:", error);
    }),
  ],
});

async function handleRequest(request: Request) {
  const { response } = await handler.handle(request, {
    prefix: "/rpc",
    context: {},
  });

  return response ?? new Response("Not found", { status: 404 });
}

export const HEAD = handleRequest;
export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
