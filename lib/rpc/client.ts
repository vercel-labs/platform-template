
import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AppRouter } from "./router";

const link = new RPCLink({
  url: () => {
    if (typeof window === "undefined") {
      throw new Error("oRPC client is only for browser use");
    }
    return `${window.location.origin}/rpc`;
  },
});

export const rpc: RouterClient<AppRouter> = createORPCClient(link);
