import { test, expect, describe, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { CodexAgentProvider } from "./codex-agent";
import type { StreamChunk, SandboxContext, ProxyConfig } from "./types";

const PROXY_BASE_URL =
  process.env.PROXY_BASE_URL ||
  "https://platform-template.labs.vercel.dev/api/ai/proxy";

const SESSION_URL = "https://platform-template.labs.vercel.dev/api/ai/session";

async function collectChunks(
  iterable: AsyncIterable<StreamChunk>,
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

function findChunks<T extends StreamChunk["type"]>(
  chunks: StreamChunk[],
  type: T,
): Extract<StreamChunk, { type: T }>[] {
  return chunks.filter(
    (c): c is Extract<StreamChunk, { type: T }> => c.type === type,
  );
}

describe("Codex Agent", () => {
  describe("installation", () => {
    let sandbox: Sandbox;

    afterAll(async () => {
      if (sandbox) {
        await sandbox.stop();
      }
    });

    test("should install codex CLI with bun", async () => {
      sandbox = await Sandbox.create({
        ports: [3000],
        timeout: 300_000,
      });

      // Install bun first
      const bunInstall = await sandbox.runCommand({
        cmd: "sh",
        args: [
          "-c",
          "curl -fsSL https://bun.sh/install | bash && ln -sf /root/.bun/bin/bun /usr/local/bin/bun && ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx",
        ],
        sudo: true,
      });
      expect(bunInstall.exitCode).toBe(0);

      // Install codex (pin to 0.94.0, last version that supports wire_api="chat")
      const codexInstall = await sandbox.runCommand({
        cmd: "bun",
        args: ["i", "-g", "@openai/codex@0.94.0"],
        sudo: true,
      });
      expect(codexInstall.exitCode).toBe(0);

      // Verify codex is available in PATH
      const codexVersion = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", "export PATH=\"$PATH:/root/.bun/bin\" && codex --version"],
        sudo: true,
      });
      expect(codexVersion.exitCode).toBe(0);
      expect(await codexVersion.stdout()).toContain("codex-cli");
    }, 120_000);


  });

  describe("execution", () => {
    let provider: CodexAgentProvider;
    let sandbox: Sandbox;
    let sandboxContext: SandboxContext;
    let proxyConfig: ProxyConfig;

    beforeAll(async () => {
      provider = new CodexAgentProvider();

      // Create session for proxy
      const response = await fetch(SESSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status}`);
      }

      const data = await response.json();

      proxyConfig = {
        sessionId: data.sessionId,
        baseUrl: PROXY_BASE_URL,
      };

      // Create a fresh sandbox and install codex
      sandbox = await Sandbox.create({
        ports: [3000],
        timeout: 300_000,
      });

      // Install bun
      await sandbox.runCommand({
        cmd: "sh",
        args: [
          "-c",
          "curl -fsSL https://bun.sh/install | bash && ln -sf /root/.bun/bin/bun /usr/local/bin/bun && ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx",
        ],
        sudo: true,
      });

      // Install codex (pin to 0.94.0, last version that supports wire_api="chat")
      await sandbox.runCommand({
        cmd: "bun",
        args: ["i", "-g", "@openai/codex@0.94.0"],
        sudo: true,
      });

      sandboxContext = {
        sandboxId: sandbox.sandboxId,
        sandbox,
        templateId: "nextjs",
      };
    }, 120_000);

    afterAll(async () => {
      if (sandbox) {
        await sandbox.stop();
      }
    });

    test("should run codex CLI directly", async () => {
      // Test the exact command the provider runs
      const cliArgs = [
        "exec",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "-C", "/vercel/sandbox",
        "-c", `'model_providers.vercel.name="Vercel AI Gateway Proxy"'`,
        "-c", `'model_providers.vercel.base_url="${proxyConfig.baseUrl}/v1"'`,
        "-c", `'model_providers.vercel.env_key="AI_GATEWAY_API_KEY"'`,
        "-c", `'model_providers.vercel.wire_api="chat"'`,
        "-c", `'model_provider="vercel"'`,
        "-m", "openai/gpt-5.2-codex",
        `'Say hello'`,
      ];

      const command = `export PATH="$PATH:/root/.local/bin:/root/.bun/bin" && export AI_GATEWAY_API_KEY="${proxyConfig.sessionId}" && codex ${cliArgs.join(" ")}`;

      const result = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", command],
        cwd: "/vercel/sandbox",
        sudo: true,
      });

      expect(result.exitCode).toBe(0);
    }, 120_000);

    test("should execute a simple prompt through the provider", async () => {
      const chunks = await collectChunks(
        provider.execute({
          prompt: "Say 'CODEX_TEST_SUCCESS' and nothing else.",
          sandboxContext,
          proxyConfig,
        }),
      );

      const errors = findChunks(chunks, "error");
      if (errors.length > 0) {
        console.error("Errors:", errors);
      }

      const textDeltas = findChunks(chunks, "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      const fullText = textDeltas.map((c) => c.text).join("");

      expect(fullText).toContain("CODEX_TEST_SUCCESS");
    }, 120_000);
  });
});
