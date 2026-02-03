import { os } from "@orpc/server";
import type { Sandbox } from "@vercel/sandbox";
import { SkipAutoDetectionConfirmation } from "@vercel/sdk/models/createdeploymentop.js";
import { z } from "zod";
import { Result } from "better-result";
import { SANDBOX_BASE_PATH } from "@/lib/agents";
import {
  SandboxError,
  FileNotFoundError,
  NetworkError,
  errorMessage,
} from "@/lib/errors";
import { getSandbox, getVercelClient } from "../utils";
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
      const vercel = yield* Result.await(getVercelClient());
      const sandbox = yield* Result.await(getSandbox(sandboxId));

      const filePaths = yield* Result.await(
        listDeployableFiles(sandbox, sandboxId),
      );
      const files = yield* Result.await(readFilesForDeploy(sandbox, filePaths));

      const name =
        deploymentName ||
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
              skipAutoDetectionConfirmation: SkipAutoDetectionConfirmation.One,
            }),
          catch: (err) =>
            new NetworkError({
              message: `Failed to deploy: ${errorMessage(err)}`,
            }),
        }),
      );

      if (!projectId) {
        await vercel.projects.updateProject({
          requestBody: { ssoProtection: null },
          idOrName: deployment.projectId,
        });
      }

      return Result.ok({
        url: deployment.url,
        id: deployment.id,
        projectId: deployment.projectId,
      });
    }),
  );
export const getDeploymentStatus = os
  .input(z.object({ deploymentId: z.string() }))
  .handler(({ input: { deploymentId } }) =>
    Result.gen(async function* () {
      const vercel = yield* Result.await(getVercelClient());
      const deployment = yield* Result.await(
        Result.tryPromise({
          try: () =>
            vercel.deployments.getDeployment({ idOrUrl: deploymentId }),
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

type LogEvent =
  | { type: "stdout" | "stderr" | "command"; text: string; timestamp: number }
  | { type: "state"; readyState: string; timestamp: number }
  | { type: "done"; readyState: string; timestamp: number }
  | { type: "error"; message: string; timestamp: number };

const TERMINAL_STATES = ["READY", "ERROR", "CANCELED"];
const LOG_TYPES = ["stdout", "stderr", "command"];
export const streamDeploymentLogs = os
  .input(z.object({ deploymentId: z.string() }))
  .handler(async function* ({
    input: { deploymentId },
  }): AsyncGenerator<LogEvent> {
    const vercelResult = await getVercelClient();
    if (vercelResult.isErr()) {
      yield { type: "error", message: "Unauthorized", timestamp: Date.now() };
      return;
    }
    const vercel = vercelResult.value;

    let lastSerial = "";

    while (true) {
      try {
        const { readyState } = await vercel.deployments.getDeployment({
          idOrUrl: deploymentId,
        });

        const events = (await vercel.deployments.getDeploymentEvents({
          idOrUrl: deploymentId,
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
