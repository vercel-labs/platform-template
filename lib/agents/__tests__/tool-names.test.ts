/**
 * Test to check what tool names the agent sees
 */

import { test, describe } from "vitest";
import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Use Haiku for tests to minimize cost
const TEST_MODEL = "haiku";

describe("Tool Names Investigation", () => {
  test("check registered tool names", async () => {
    const sandboxMcp = createSdkMcpServer({
      name: "sandbox",
      tools: [
        {
          name: "Write",
          description: "Write a file",
          inputSchema: { file_path: z.string(), content: z.string() },
          handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
        },
        {
          name: "Read", 
          description: "Read a file",
          inputSchema: { file_path: z.string() },
          handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
        },
      ],
    });

    const queryResult = query({
      prompt: "What tools do you have access to? Just list them.",
      options: {
        tools: [],
        mcpServers: { sandbox: sandboxMcp },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        systemPrompt: "You are a helpful assistant. List the tools you have access to.",
        includePartialMessages: true,
        persistSession: false,
        model: TEST_MODEL,
      },
    });

    console.log("\n=== SDK Messages ===");
    for await (const msg of queryResult) {
      if (msg.type === "system" && msg.subtype === "init") {
        console.log("Registered tools:", (msg as any).tools);
      }
      if (msg.type === "stream_event") {
        const event = (msg as any).event;
        if (event?.type === "content_block_delta" && event?.delta?.text) {
          process.stdout.write(event.delta.text);
        }
      }
    }
    console.log("\n");
  }, 60_000);
});
