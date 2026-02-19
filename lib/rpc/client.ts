/**
 * Type-safe RPC client for browser use.
 *
 * Usage:
 *   import { rpc } from "@/lib/rpc/client";
 *
 *   // Call procedures with full type safety
 *   const result = await rpc.sandbox.readFile({ sandboxId, path });
 *   if (result.isOk()) {
 *     console.log(result.value.content);
 *   }
 *
 *   // Stream responses
 *   for await (const chunk of rpc.chat.send({ prompt })) {
 *     console.log(chunk);
 *   }
 */

import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AppRouter } from "./router";
import { customJsonSerializers } from "./result-serializer";
import { waitForBotIdSession } from "@/components/auth/session-store";

const link = new RPCLink({
  url: () => {
    if (typeof window === "undefined") {
      throw new Error("RPC client is only available in the browser");
    }
    return `${window.location.origin}/rpc`;
  },
  customJsonSerializers,
  fetch: async (request, init) => {
    // Wait for the BotID session cookie to be established before sending
    // any RPC request, preventing 403s from the server-side gate.
    await waitForBotIdSession();
    return globalThis.fetch(request, init);
  },
});

export const rpc: RouterClient<AppRouter> = createORPCClient(link);
