/**
 * oRPC Router Definition
 *
 * This file defines the structure of all RPC endpoints.
 * The router is consumed by:
 * - Server: app/rpc/[[...rest]]/route.ts
 * - Client: lib/rpc/client.ts (type-safe client)
 */

import * as sandbox from "./procedures/sandbox";
import * as chat from "./procedures/chat";
import * as deploy from "./procedures/deploy";

export const router = {
  /** Sandbox file operations */
  sandbox: {
    readFile: sandbox.readFile,
    listFiles: sandbox.listFiles,
    getOrCreate: sandbox.getOrCreateSandbox,
  },
  /** AI chat with streaming responses */
  chat: {
    send: chat.sendMessage,
  },
  /** Vercel deployment operations */
  deploy: {
    files: deploy.deployFiles,
    status: deploy.getDeploymentStatus,
    logs: deploy.streamDeploymentLogs,
  },
};

export type AppRouter = typeof router;
