
import { test, expect, describe, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { nanoid } from "nanoid";
import { CodexAgentProvider } from "./codex-agent";
import { createSession } from "@/lib/redis";
import type { StreamChunk, SandboxContext, ProxyConfig } from "./types";

const PROXY_BASE_URL =
  process.env.PROXY_BASE_URL ||
  "https://platform-template.labs.vercel.dev/api/ai/proxy";

const SESSION_URL = "https://platform-template.labs.vercel.dev/api/ai/session";

async function collectChunks(
  iterable: AsyncIterable<StreamChunk>
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

function findChunks<T extends StreamChunk["type"]>(
  chunks: StreamChunk[],
  type: T
): Extract<StreamChunk, { type: T }>[] {
  return chunks.filter(
    (c): c is Extract<StreamChunk, { type: T }> => c.type === type
  );
}

describe("Codex Agent", () => {
  let provider: CodexAgentProvider;
  let sandbox: Sandbox;
  let sandboxContext: SandboxContext;
  let proxyConfig: ProxyConfig;

  beforeAll(async () => {
    const snapshotId = process.env.NEXTJS_SNAPSHOT_ID;

    if (!snapshotId) {
      throw new Error("NEXTJS_SNAPSHOT_ID is required for sandbox tests");
    }

    provider = new CodexAgentProvider();

    const response = await fetch(SESSION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Created session: ${data.sessionId}`);

    proxyConfig = {
      sessionId: data.sessionId,
      baseUrl: PROXY_BASE_URL,
    };

    console.log("Creating sandbox from snapshot...");
    sandbox = await Sandbox.create({
      source: { type: "snapshot", snapshotId },
      ports: [3000],
      timeout: 300_000,
      resources: { vcpus: 2 },
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

  test(
    "should execute a simple prompt through the proxy",
    async () => {
      const chunks = await collectChunks(
        provider.execute({
          prompt: "Say 'CODEX_TEST_SUCCESS' and nothing else.",
          sandboxContext,
          proxyConfig,
        })
      );

      const errors = findChunks(chunks, "error");
      if (errors.length > 0) {
        console.error("Errors:", errors);
      }

      const textDeltas = findChunks(chunks, "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      const fullText = textDeltas.map((c) => c.text).join("");
      console.log("Response through proxy:", fullText);

      expect(fullText).toContain("CODEX_TEST_SUCCESS");
    },
    120_000
  );
});
