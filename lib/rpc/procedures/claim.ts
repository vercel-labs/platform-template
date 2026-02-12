/**
 * Claim Deployment Procedures
 *
 * Handles the project transfer/claim flow:
 * 1. Create a transfer request for a partner-owned project
 * 2. User completes OAuth flow with transfer_code
 * 3. Project is transferred to user's account
 * 4. Platform retains access via stored OAuth tokens
 */

import { os } from "@orpc/server";
import { z } from "zod";
import { Result } from "better-result";
import { NetworkError, ValidationError, errorMessage } from "@/lib/errors";
import { getPartnerClient } from "../utils";
import { getProjectTokens, isProjectClaimed } from "@/lib/project-tokens";

/**
 * Internal function to create a transfer request.
 * Reused by both the RPC handler and getClaimUrl.
 */
/**
 * Wait for all in-progress deployments to complete before transferring.
 * Vercel rejects transfer requests while deployments are in progress.
 */
async function waitForDeploymentsToSettle(
  client: import("@vercel/sdk").Vercel,
  projectId: string,
  teamId?: string,
  maxWaitMs = 60_000,
): Promise<void> {
  const POLL_INTERVAL = 2_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const deployments = await client.deployments.getDeployments({
      projectId,
      teamId,
      limit: 5,
      state: "building" as never,
    });

    const inProgress = (deployments.deployments ?? []).filter(
      (d) => d.readyState === "BUILDING" || d.readyState === "QUEUED" || d.readyState === "INITIALIZING",
    );

    if (inProgress.length === 0) return;

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

async function createTransferRequestInternal(projectId: string) {
  // Get partner client (only partner can create transfer requests)
  const partnerResult = getPartnerClient();
  if (partnerResult.isErr()) {
    return Result.err(partnerResult.error);
  }
  const { client, teamId } = partnerResult.value;

  // Check if project is already claimed
  const claimed = await isProjectClaimed(projectId);
  if (claimed) {
    return Result.err(
      new ValidationError({
        message: "Project has already been claimed",
      }),
    );
  }

  // Wait for any in-progress deployments to finish before transferring
  await waitForDeploymentsToSettle(client, projectId, teamId);

  // Create the transfer request via Vercel SDK
  const transferResult = await Result.tryPromise({
    try: () =>
      client.projects.createProjectTransferRequest({
        idOrName: projectId,
        teamId,
        requestBody: {},
      }),
    catch: (err) =>
      new NetworkError({
        message: `Failed to create transfer request: ${errorMessage(err)}`,
      }),
  });

  if (transferResult.isErr()) {
    return transferResult;
  }

  return Result.ok({
    transferCode: transferResult.value.code,
    projectId,
  });
}

/**
 * Create a transfer request for a project.
 * This generates a transfer_code that can be included in the OAuth flow
 * to claim the project during sign-in.
 */
export const createTransferRequest = os
  .input(
    z.object({
      projectId: z.string(),
    }),
  )
  .handler(async ({ input: { projectId } }) => {
    return createTransferRequestInternal(projectId);
  });

/**
 * Get the status of a project (claimed or not, owner info, etc.)
 */
export const getProjectStatus = os
  .input(
    z.object({
      projectId: z.string(),
    }),
  )
  .handler(async ({ input: { projectId } }) => {
    const tokens = await getProjectTokens(projectId);

    if (!tokens) {
      return Result.ok({
        projectId,
        claimed: false,
        ownership: "partner" as const,
      });
    }

    return Result.ok({
      projectId,
      claimed: !!tokens.transferredAt,
      ownership: tokens.transferredAt ? ("user" as const) : ("partner" as const),
      claimedAt: tokens.transferredAt,
      userId: tokens.userId,
    });
  });

/**
 * Build the OAuth URL for claiming a project.
 * Includes the transfer_code to trigger the claim during sign-in.
 */
export const getClaimUrl = os
  .input(
    z.object({
      projectId: z.string(),
      redirectTo: z.string().optional(),
    }),
  )
  .handler(async ({ input: { projectId, redirectTo } }) => {
    // First create a transfer request
    const transferResult = await createTransferRequestInternal(projectId);

    if (transferResult.isErr()) {
      return transferResult;
    }

    const { transferCode } = transferResult.value;

    // Build the sign-in URL with transfer_code
    // Use URLSearchParams to build query string, return relative URL for client to use
    const params = new URLSearchParams();
    params.set("transfer_code", transferCode);
    params.set("project_id", projectId);
    if (redirectTo) {
      params.set("next", redirectTo);
    }

    const url = `/api/auth/signin/vercel?${params.toString()}`;

    return Result.ok({
      url,
      transferCode,
      projectId,
    });
  });
