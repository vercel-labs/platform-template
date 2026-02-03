import { os } from "@orpc/server";
import { z } from "zod";
import { Result } from "better-result";
import { Sandbox } from "@vercel/sandbox";
import {
  SANDBOX_BASE_PATH,
  SANDBOX_DEV_PORT,
  SANDBOX_VITE_PORT,
  SANDBOX_TIMEOUT_MS,
} from "@/lib/agents";
import {
  SandboxError,
  FileNotFoundError,
  PathValidationError,
  errorMessage,
} from "@/lib/errors";
import { getSandbox } from "../utils";
export const readFile = os
  .input(z.object({ sandboxId: z.string(), path: z.string() }))
  .handler(({ input: { sandboxId, path } }) =>
    Result.gen(async function* () {
      if (!path.startsWith(SANDBOX_BASE_PATH)) {
        return Result.err(
          new PathValidationError({
            path,
            message: `Path must be within ${SANDBOX_BASE_PATH}`,
          }),
        );
      }

      const sandbox = yield* Result.await(getSandbox(sandboxId));

      const stream = yield* Result.await(
        Result.tryPromise({
          try: () => sandbox.readFile({ path }),
          catch: (err) =>
            new FileNotFoundError({ path, message: errorMessage(err) }),
        }),
      );

      if (!stream) {
        return Result.err(
          new FileNotFoundError({ path, message: `File not found: ${path}` }),
        );
      }

      const chunks: (string | Buffer)[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const content = chunks
        .map((chunk) =>
          typeof chunk === "string" ? chunk : chunk.toString("utf-8"),
        )
        .join("");

      return Result.ok({ content, path });
    }),
  );
export const listFiles = os
  .input(
    z.object({
      sandboxId: z.string(),
      path: z.string().optional().default(SANDBOX_BASE_PATH),
    }),
  )
  .handler(({ input: { sandboxId, path } }) =>
    Result.gen(async function* () {
      const sandbox = yield* Result.await(getSandbox(sandboxId));

      const result = yield* Result.await(
        Result.tryPromise({
          try: () =>
            sandbox.runCommand({
              cmd: "find",
              args: [path, "-type", "f", "-not", "-path", "*/node_modules/*"],
            }),
          catch: (err) =>
            new SandboxError({ message: errorMessage(err), sandboxId }),
        }),
      );

      const files = (await result.stdout()).split("\n").filter(Boolean);
      return Result.ok({ files });
    }),
  );
export const getOrCreateSandbox = os
  .input(z.object({ sandboxId: z.string().optional() }))
  .handler(async ({ input: { sandboxId } }) => {
    if (sandboxId) {
      return Result.tryPromise({
        try: async () => ({
          sandboxId: (await Sandbox.get({ sandboxId })).sandboxId,
          isNew: false,
        }),
        catch: (err) =>
          new SandboxError({ message: errorMessage(err), sandboxId }),
      });
    }

    return Result.tryPromise({
      try: async () => ({
        sandboxId: (
          await Sandbox.create({
            ports: [SANDBOX_DEV_PORT, SANDBOX_VITE_PORT],
            timeout: SANDBOX_TIMEOUT_MS,
          })
        ).sandboxId,
        isNew: true,
      }),
      catch: (err) => new SandboxError({ message: errorMessage(err) }),
    });
  });
