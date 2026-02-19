import { os } from "@orpc/server";
import type { Sandbox } from "@vercel/sandbox";
import { Vercel } from "@vercel/sdk";
import { SkipAutoDetectionConfirmation } from "@vercel/sdk/models/createdeploymentop.js";
import { z } from "zod";
import { Result } from "better-result";
import { after } from "next/server";
import { SANDBOX_BASE_PATH } from "@/lib/agents";
import {
  SandboxError,
  FileNotFoundError,
  NetworkError,
  ValidationError,
  errorMessage,
} from "@/lib/errors";
import { getSandboxSession, saveSandboxSession } from "@/lib/chat-history";
import {
  getSandbox,
  getVercelClient,
  getPartnerClient,
  getProjectClient,
  isUserSignedIn,
} from "../utils";
import { isProjectClaimed } from "@/lib/project-tokens";

/**
 * Project ownership indicates who currently owns the deployed project:
 * - 'partner': Project is on the partner team (not yet claimed)
 * - 'user': Project has been claimed by a user
 */
export type ProjectOwnership = "partner" | "user";
function toRelativePath(filePath: string): string {
  return filePath
    .replace(new RegExp(`^${SANDBOX_BASE_PATH}/?`), "")
    .replace(/^\//, "");
}
async function listDeployableFiles(
  sandbox: Sandbox,
  sandboxId: string,
): Promise<Result<string[], SandboxError>> {
  const result = await sandbox.runCommand("find", [
    SANDBOX_BASE_PATH,
    "-type",
    "f",
    "-not",
    "-path",
    "*/node_modules/*",
    "-not",
    "-path",
    "*/.git/*",
    "-not",
    "-path",
    "*/.next/*",
    "-not",
    "-name",
    "*.log",
  ]);

  if (result.exitCode !== 0) {
    return Result.err(
      new SandboxError({
        message: `Failed to list files: ${await result.stderr()}`,
        sandboxId,
      }),
    );
  }

  const files = (await result.stdout())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return Result.ok(files);
}
async function readFileForDeploy(
  sandbox: Sandbox,
  path: string,
): Promise<Result<{ file: string; data: string }, FileNotFoundError>> {
  const stream = await sandbox.readFile({ path });
  if (!stream) {
    return Result.err(
      new FileNotFoundError({ message: `File not found: ${path}`, path }),
    );
  }

  const data = await new Response(stream as unknown as ReadableStream).text();
  return Result.ok({ file: toRelativePath(path), data });
}
async function readFilesForDeploy(
  sandbox: Sandbox,
  paths: string[],
): Promise<Result<{ file: string; data: string }[], FileNotFoundError>> {
  const files: { file: string; data: string }[] = [];

  for (const path of paths) {
    const result = await readFileForDeploy(sandbox, path);
    if (result.isErr()) {
      return result;
    }
    files.push(result.value);
  }

  return Result.ok(files);
}
/**
 * Get the appropriate Vercel client based on project state and user authentication.
 *
 * Priority:
 * 1. If projectId exists and is claimed -> use stored project tokens
 * 2. If user is signed in -> use user's OAuth token
 * 3. Otherwise -> use partner token (for initial deploys)
 */
async function getDeploymentClient(projectId: string | null | undefined): Promise<
  Result<{ client: Vercel; teamId?: string; ownership: ProjectOwnership }, ValidationError>
> {
  // If we have a project ID, check if it's been claimed
  if (projectId) {
    const claimed = await isProjectClaimed(projectId);
    if (claimed) {
      const clientResult = await getProjectClient(projectId);
      if (clientResult.isOk()) {
        return Result.ok({
          client: clientResult.value,
          ownership: "user",
        });
      }
      // If project tokens are invalid, fall through to try user session
      console.warn("[deploy] Project tokens invalid, trying user session");
    }
  }

  // Check if user is signed in
  const signedIn = await isUserSignedIn();
  if (signedIn) {
    const clientResult = await getVercelClient();
    if (clientResult.isOk()) {
      return Result.ok({
        client: clientResult.value,
        ownership: "user",
      });
    }
  }

  // Fall back to partner client for signed-out users
  const partnerResult = getPartnerClient();
  if (partnerResult.isErr()) {
    return Result.err(
      new ValidationError({
        message: "Unable to deploy: please sign in or contact support",
      }),
    );
  }

  return Result.ok({
    client: partnerResult.value.client,
    teamId: partnerResult.value.teamId,
    ownership: "partner",
  });
}

export const deployFiles = os
  .input(
    z.object({
      sandboxId: z.string(),
      deploymentName: z.string().optional(),
      projectId: z.string().nullable().optional(),
    }),
  )
  .handler(({ input: { sandboxId, deploymentName, projectId } }) =>
    Result.gen(async function* () {
      const { client: vercel, teamId, ownership } = yield* Result.await(
        getDeploymentClient(projectId),
      );
      const sandbox = yield* Result.await(getSandbox(sandboxId));

      const filePaths = yield* Result.await(
        listDeployableFiles(sandbox, sandboxId),
      );
      const files = yield* Result.await(readFilesForDeploy(sandbox, filePaths));

      // Sanitize deployment name to meet Vercel project name requirements:
      // lowercase, up to 100 chars, only letters/digits/'.'/'-'/'_', no '---'
      const sanitizedName = deploymentName
        ? deploymentName
            .toLowerCase()
            .replace(/\.vercel\.app$/i, "")  // strip .vercel.app suffix if user included it
            .replace(/[^a-z0-9._-]/g, "-")  // replace invalid chars with hyphens
            .replace(/---+/g, "--")          // collapse --- sequences
            .replace(/^-+|-+$/g, "")         // trim leading/trailing hyphens
            .slice(0, 100)
        : undefined;

      const name =
        sanitizedName ||
        `platform-deploy-${Math.random().toString(36).slice(2, 6)}`;

      const deployment = yield* Result.await(
        Result.tryPromise({
          try: () =>
            vercel.deployments.createDeployment({
              requestBody: {
                name,
                files,
                target: "production",
                project: projectId ?? undefined,
              },
              // Include teamId for partner deployments
              teamId,
              skipAutoDetectionConfirmation: SkipAutoDetectionConfirmation.One,
            }),
          catch: (err) =>
            new NetworkError({
              message: `Failed to deploy: ${errorMessage(err)}`,
            }),
        }),
      );

      // For new projects: disable SSO protection and add custom domain if specified
      if (!projectId) {
        const postDeployOps: Promise<unknown>[] = [
          vercel.projects.updateProject({
            requestBody: { ssoProtection: null },
            idOrName: deployment.projectId,
            teamId,
          }),
        ];

        // Add custom .vercel.app domain if a custom name was provided
        if (sanitizedName) {
          postDeployOps.push(
            vercel.projects.addProjectDomain({
              idOrName: deployment.projectId,
              teamId,
              requestBody: { name: `${sanitizedName}.vercel.app` },
            }).catch((err) => {
              // Non-fatal: domain might already be taken or invalid
              console.warn(`[deploy] Failed to add custom domain: ${errorMessage(err)}`);
            }),
          );
        }

        await Promise.all(postDeployOps);
      }

      // Persist deployment state to Redis so it survives page reloads (e.g. after claim flow).
      // Using after() ensures the serverless function stays alive until this completes.
      const sandboxIdForSession = sandboxId;
      after(async () => {
        try {
          const existing = await getSandboxSession(sandboxIdForSession);
          await saveSandboxSession(sandboxIdForSession, {
            ...existing,
            messages: existing?.messages ?? [],
            projectId: deployment.projectId,
            projectOwnership: ownership,
            deploymentUrl: deployment.url,
          });
        } catch (err) {
          console.warn("[deploy] Failed to persist deployment state:", err);
        }
      });

      return Result.ok({
        url: deployment.url,
        id: deployment.id,
        projectId: deployment.projectId,
        ownership,
      });
    }),
  );
export const getDeploymentStatus = os
  .input(
    z.object({
      deploymentId: z.string(),
      projectId: z.string().nullable().optional(),
    }),
  )
  .handler(({ input: { deploymentId, projectId } }) =>
    Result.gen(async function* () {
      const { client: vercel, teamId } = yield* Result.await(
        getDeploymentClient(projectId),
      );
      const deployment = yield* Result.await(
        Result.tryPromise({
          try: () =>
            vercel.deployments.getDeployment({ idOrUrl: deploymentId, teamId }),
          catch: (err) => new NetworkError({ message: errorMessage(err) }),
        }),
      );
      return Result.ok({
        readyState: deployment.readyState,
        url: deployment.url,
        id: deployment.id,
      });
    }),
  );

export type LogEvent =
  | { type: "stdout" | "stderr" | "command"; text: string; timestamp: number }
  | { type: "state"; readyState: string; timestamp: number }
  | { type: "done"; readyState: string; timestamp: number }
  | { type: "error"; message: string; timestamp: number };

const TERMINAL_STATES = ["READY", "ERROR", "CANCELED"];
const LOG_TYPES = ["stdout", "stderr", "command"];
export const streamDeploymentLogs = os
  .input(
    z.object({
      deploymentId: z.string(),
      projectId: z.string().nullable().optional(),
    }),
  )
  .handler(async function* ({
    input: { deploymentId, projectId },
  }): AsyncGenerator<LogEvent> {
    const clientResult = await getDeploymentClient(projectId);
    if (clientResult.isErr()) {
      yield { type: "error", message: clientResult.error.message, timestamp: Date.now() };
      return;
    }
    const { client: vercel, teamId } = clientResult.value;

    let lastSerial = "";

    while (true) {
      try {
        const { readyState } = await vercel.deployments.getDeployment({
          idOrUrl: deploymentId,
          teamId,
        });

        const events = (await vercel.deployments.getDeploymentEvents({
          idOrUrl: deploymentId,
          teamId,
          direction: "forward",
          limit: -1,
          builds: 1,
        })) as Array<{
          type: string;
          serial?: string;
          text?: string;
          payload?: {
            serial?: string;
            text?: string;
            info?: { readyState?: string };
          };
          info?: { readyState?: string };
        }>;

        for (const event of events ?? []) {
          const serial = event.serial ?? event.payload?.serial;
          if (serial && serial <= lastSerial) continue;
          if (serial) lastSerial = serial;

          const text = event.text ?? event.payload?.text;
          if (text && LOG_TYPES.includes(event.type)) {
            yield {
              type: event.type as "stdout" | "stderr" | "command",
              text,
              timestamp: Date.now(),
            };
          }

          const state =
            event.info?.readyState ?? event.payload?.info?.readyState;
          if (event.type === "deployment-state" && state) {
            yield { type: "state", readyState: state, timestamp: Date.now() };
          }
        }

        if (TERMINAL_STATES.includes(readyState as string)) {
          yield {
            type: "done",
            readyState: String(readyState),
            timestamp: Date.now(),
          };
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (err) {
        yield {
          type: "error",
          message: errorMessage(err),
          timestamp: Date.now(),
        };
        return;
      }
    }
  });
