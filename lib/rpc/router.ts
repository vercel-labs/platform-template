/**
 * oRPC Router Definition
 *
 * This file defines the structure of all RPC endpoints.
 * The router is consumed by:
 * - Server: app/rpc/[[...rest]]/route.ts
 * - Client: lib/rpc/client.ts (type-safe client)
 */

import * as sandbox from "./procedures/sandbox";
import * as deploy from "./procedures/deploy";
import * as claim from "./procedures/claim";

export const router = {
  sandbox: {
    readFile: sandbox.readFile,
    listFiles: sandbox.listFiles,
    getOrCreate: sandbox.getOrCreateSandbox,
    // Read-only session access - persistence is handled server-side in the chat API route
    getSession: sandbox.getSessionRpc,
  },
  deploy: {
    files: deploy.deployFiles,
    status: deploy.getDeploymentStatus,
    logs: deploy.streamDeploymentLogs,
  },
  claim: {
    createTransferRequest: claim.createTransferRequest,
    getProjectStatus: claim.getProjectStatus,
    getClaimUrl: claim.getClaimUrl,
  },
};

export type AppRouter = typeof router;
