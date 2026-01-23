/**
 * Test to reproduce duplicate output issue
 *
 * Run with: pnpm vitest run lib/agents/__tests__/duplicate-output.test.ts
 */

import { test, expect, describe, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { ClaudeAgentProvider } from "../claude-agent";
import type { StreamChunk, SandboxContext } from "../types";

// Use Haiku for tests to minimize cost
const TEST_MODEL = "haiku";

// Helper to collect all chunks
async function collectChunks(
  iterable: AsyncIterable<StreamChunk>
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

// Helper to extract all text from chunks
function extractAllText(chunks: StreamChunk[]): string {
  return chunks
    .filter((c): c is Extract<StreamChunk, { type: "text-delta" }> => c.type === "text-delta")
    .map((c) => c.text)
    .join("");
}

describe("Duplicate Output Investigation", () => {
  let provider: ClaudeAgentProvider;
  let sandbox: Sandbox;
  let sandboxContext: SandboxContext;

  beforeAll(async () => {
    provider = new ClaudeAgentProvider();

    console.log("Creating sandbox...");
    sandbox = await Sandbox.create({
      ports: [3000, 5173],
      timeout: 300_000,
    });
    console.log(`Sandbox created: ${sandbox.sandboxId}`);

    sandboxContext = {
      sandboxId: sandbox.sandboxId,
      sandbox,
    };
  }, 60_000);

  afterAll(async () => {
    if (sandbox) {
      console.log("Stopping sandbox...");
      await sandbox.stop();
    }
  });

  test("should NOT produce duplicate text output", async () => {
    const chunks = await collectChunks(
      provider.execute({
        prompt: "Say exactly: 'Hello World'. Nothing else.",
        sandboxContext,
        model: TEST_MODEL,
      })
    );

    // Log all chunks for debugging
    console.log("\n=== All Chunks ===");
    for (const chunk of chunks) {
      console.log(JSON.stringify(chunk));
    }

    // Extract all text
    const fullText = extractAllText(chunks);
    console.log("\n=== Full Text ===");
    console.log(fullText);

    // Count text-delta chunks
    const textDeltas = chunks.filter((c) => c.type === "text-delta");
    console.log(`\nTotal text-delta chunks: ${textDeltas.length}`);

    // Check for duplicates - the text "Hello World" should only appear once
    const helloCount = (fullText.match(/Hello World/gi) || []).length;
    console.log(`"Hello World" appears ${helloCount} time(s)`);

    // The issue: if duplicated, helloCount will be 2
    expect(helloCount).toBeLessThanOrEqual(1);
  }, 60_000);

  test("log chunk types and order", async () => {
    const chunks = await collectChunks(
      provider.execute({
        prompt: "Say: 'Test'",
        sandboxContext,
        model: TEST_MODEL,
      })
    );

    // Group chunks by type
    const byType = new Map<string, number>();
    for (const chunk of chunks) {
      byType.set(chunk.type, (byType.get(chunk.type) || 0) + 1);
    }

    console.log("\n=== Chunk Type Counts ===");
    for (const [type, count] of byType) {
      console.log(`${type}: ${count}`);
    }

    // Log the order of chunk types
    console.log("\n=== Chunk Order ===");
    console.log(chunks.map((c) => c.type).join(" -> "));
  }, 60_000);

  test("log raw SDK messages", async () => {
    // Import the SDK directly to see raw messages
    const { query, createSdkMcpServer } = await import("@anthropic-ai/claude-agent-sdk");
    const { z } = await import("zod");

    const sandboxMcp = createSdkMcpServer({
      name: "sandbox",
      tools: [
        {
          name: "dummy",
          description: "Dummy tool",
          inputSchema: { x: z.string() },
          handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
        },
      ],
    });

    const queryResult = query({
      prompt: "Say exactly: 'Hi'. Nothing else.",
      options: {
        tools: [],
        mcpServers: { sandbox: sandboxMcp },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        systemPrompt: "You are a helpful assistant.",
        includePartialMessages: true,
        persistSession: false,
        model: TEST_MODEL,
      },
    });

    console.log("\n=== Raw SDK Messages ===");
    for await (const msg of queryResult) {
      console.log(`\nType: ${msg.type}`);
      if (msg.type === "stream_event") {
        console.log("Event:", JSON.stringify((msg as any).event, null, 2));
      } else if (msg.type === "assistant") {
        console.log("Content:", JSON.stringify((msg as any).message?.content, null, 2));
      } else {
        console.log("Full:", JSON.stringify(msg, null, 2));
      }
    }
  }, 60_000);
});
