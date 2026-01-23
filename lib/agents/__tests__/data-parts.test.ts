/**
 * Test data part emission from tool results
 */

import { test, expect, describe, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { ClaudeAgentProvider } from "../claude-agent";
import type { StreamChunk, SandboxContext } from "../types";

// Use Haiku for tests to minimize cost
const TEST_MODEL = "haiku";

async function collectChunks(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

function findDataChunks(chunks: StreamChunk[], dataType: string) {
  return chunks.filter(
    (c): c is Extract<StreamChunk, { type: "data" }> =>
      c.type === "data" && c.dataType === dataType
  );
}

describe("Data Part Emission", () => {
  let provider: ClaudeAgentProvider;
  let sandbox: Sandbox;
  let sandboxContext: SandboxContext;

  beforeAll(async () => {
    provider = new ClaudeAgentProvider();
    sandbox = await Sandbox.create({ ports: [3000, 5173], timeout: 300_000 });
    sandboxContext = { sandboxId: sandbox.sandboxId, sandbox };
    console.log(`Sandbox created: ${sandbox.sandboxId}`);
  }, 60_000);

  afterAll(async () => {
    if (sandbox) await sandbox.stop();
  });

  test("emits file-written data part when writing files", async () => {
    const chunks = await collectChunks(
      provider.execute({
        prompt: "Write a file at /vercel/sandbox/test-data-part.txt with content 'hello'. Use the Write tool.",
        sandboxContext,
        model: TEST_MODEL,
      })
    );

    console.log("\n=== All chunks ===");
    for (const chunk of chunks) {
      console.log(JSON.stringify(chunk));
    }

    const fileWrittenParts = findDataChunks(chunks, "file-written");
    console.log("\n=== file-written data parts ===");
    console.log(fileWrittenParts);

    expect(fileWrittenParts.length).toBeGreaterThan(0);
    expect(fileWrittenParts[0].data).toHaveProperty("path");
    expect((fileWrittenParts[0].data as { path: string }).path).toContain("/vercel/sandbox/");
  }, 120_000);

  test("emits command-output data part when running commands", async () => {
    const chunks = await collectChunks(
      provider.execute({
        prompt: "Run the command 'echo hello world' using the Bash tool.",
        sandboxContext,
        model: TEST_MODEL,
      })
    );

    console.log("\n=== All chunks ===");
    for (const chunk of chunks) {
      console.log(JSON.stringify(chunk));
    }

    const commandParts = findDataChunks(chunks, "command-output");
    console.log("\n=== command-output data parts ===");
    console.log(commandParts);

    expect(commandParts.length).toBeGreaterThan(0);
  }, 120_000);
});
