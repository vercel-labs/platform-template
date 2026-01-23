/**
 * Sandbox Procedures
 *
 * oRPC procedures for sandbox operations.
 */

import { os, ORPCError } from "@orpc/server";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";

/**
 * Read a file from the sandbox
 */
export const readFile = os
  .input(
    z.object({
      sandboxId: z.string(),
      path: z.string(),
    })
  )
  .output(z.object({ content: z.string(), path: z.string() }))
  .handler(async ({ input }) => {
    const { sandboxId, path } = input;

    // Security: ensure path is within sandbox
    if (!path.startsWith("/vercel/sandbox")) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Path must be within /vercel/sandbox",
      });
    }

    try {
      const sandbox = await Sandbox.get({ sandboxId });

      // Read file content
      const stream = await sandbox.readFile({ path });
      if (!stream) {
        throw new ORPCError("NOT_FOUND", {
          message: `File not found: ${path}`,
        });
      }
      const chunks: (string | Buffer)[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const content = chunks
        .map((c) => (typeof c === "string" ? c : c.toString("utf-8")))
        .join("");

      return { content, path };
    } catch (error) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

/**
 * List files in the sandbox
 */
export const listFiles = os
  .input(
    z.object({
      sandboxId: z.string(),
      path: z.string().optional().default("/vercel/sandbox"),
    })
  )
  .output(z.object({ files: z.array(z.string()) }))
  .handler(async ({ input }) => {
    const { sandboxId, path } = input;

    try {
      const sandbox = await Sandbox.get({ sandboxId });

      const result = await sandbox.runCommand({
        cmd: "find",
        args: [path, "-type", "f", "-not", "-path", "*/node_modules/*"],
      });

      const stdout = await result.stdout();
      const files = stdout
        .split("\n")
        .filter(Boolean)
        .filter((f) => !f.includes("node_modules"));

      return { files };
    } catch (error) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `Failed to list files: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

/**
 * Get or create a sandbox
 */
export const getOrCreateSandbox = os
  .input(
    z.object({
      sandboxId: z.string().optional(),
    })
  )
  .output(
    z.object({
      sandboxId: z.string(),
      isNew: z.boolean(),
    })
  )
  .handler(async ({ input }) => {
    const { sandboxId } = input;

    try {
      if (sandboxId) {
        // Try to get existing sandbox
        const sandbox = await Sandbox.get({ sandboxId });
        return { sandboxId: sandbox.sandboxId, isNew: false };
      }

      // Create new sandbox
      const sandbox = await Sandbox.create({
        ports: [3000, 5173],
        timeout: 600_000, // 10 minutes
      });

      return { sandboxId: sandbox.sandboxId, isNew: true };
    } catch (error) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `Failed to get/create sandbox: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
