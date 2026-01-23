/**
 * Session Persistence Tests
 *
 * Tests that the agent remembers context across multiple messages
 * when using session persistence.
 *
 * Run with: pnpm vitest run lib/agents/__tests__/session-persistence.test.ts
 */

import { test, expect, describe, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { ClaudeAgentProvider } from "../claude-agent";
import type { StreamChunk, SandboxContext } from "../types";

// Use Haiku for tests to minimize cost
const TEST_MODEL = "haiku";

// Helper to collect all chunks from the async iterable
async function collectChunks(
  iterable: AsyncIterable<StreamChunk>
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

// Helper to find specific chunk types
function findChunks<T extends StreamChunk["type"]>(
  chunks: StreamChunk[],
  type: T
): Extract<StreamChunk, { type: T }>[] {
  return chunks.filter((c): c is Extract<StreamChunk, { type: T }> => c.type === type);
}

// Helper to get full text from chunks
function getFullText(chunks: StreamChunk[]): string {
  return findChunks(chunks, "text-delta")
    .map((c) => c.text)
    .join("");
}

// Helper to get session ID from chunks
function getSessionId(chunks: StreamChunk[]): string | undefined {
  const messageStarts = findChunks(chunks, "message-start");
  return messageStarts[0]?.sessionId;
}

describe("Session Persistence", () => {
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

  test("should emit session ID in message-start", async () => {
    const chunks = await collectChunks(
      provider.execute({
        prompt: "Say hello",
        sandboxContext,
        model: TEST_MODEL,
      })
    );

    const messageStarts = findChunks(chunks, "message-start");
    expect(messageStarts.length).toBe(1);
    expect(messageStarts[0].sessionId).toBeDefined();
    expect(typeof messageStarts[0].sessionId).toBe("string");
    expect(messageStarts[0].sessionId!.length).toBeGreaterThan(0);

    console.log("Session ID:", messageStarts[0].sessionId);
  }, 60_000);

  test("should remember context when resuming session", async () => {
    // First message: Tell the agent a secret word
    const secretWord = "elephant";
    const chunks1 = await collectChunks(
      provider.execute({
        prompt: `Remember this secret word: "${secretWord}". Just say OK if you understand.`,
        sandboxContext,
        model: TEST_MODEL,
      })
    );

    const sessionId = getSessionId(chunks1);
    expect(sessionId).toBeDefined();
    console.log("Session ID from first message:", sessionId);

    const response1 = getFullText(chunks1);
    console.log("First response:", response1);

    // Second message: Ask for the secret word (with session ID)
    const chunks2 = await collectChunks(
      provider.execute({
        prompt: "What was the secret word I told you earlier?",
        sandboxContext,
        sessionId,
        model: TEST_MODEL,
      })
    );

    const response2 = getFullText(chunks2);
    console.log("Second response:", response2);

    // The agent should remember the secret word
    expect(response2.toLowerCase()).toContain(secretWord);
  }, 120_000);

  test("should NOT remember context without session ID", async () => {
    // First message: Tell the agent a secret number
    const secretNumber = "42";
    const chunks1 = await collectChunks(
      provider.execute({
        prompt: `Remember this secret number: ${secretNumber}. Just say OK if you understand.`,
        sandboxContext,
        model: TEST_MODEL,
      })
    );

    const sessionId = getSessionId(chunks1);
    expect(sessionId).toBeDefined();
    console.log("Session ID (not reusing):", sessionId);

    const response1 = getFullText(chunks1);
    console.log("First response:", response1);

    // Second message: Ask for the secret number WITHOUT session ID
    // This creates a new session, so it shouldn't remember
    const chunks2 = await collectChunks(
      provider.execute({
        prompt: "What was the secret number I told you earlier? If you don't know, say 'I don't know'.",
        sandboxContext,
        model: TEST_MODEL,
        // Note: NOT passing sessionId
      })
    );

    const response2 = getFullText(chunks2);
    console.log("Second response (no session):", response2);

    // The agent should NOT remember since we didn't resume the session
    // It should either say it doesn't know or give an incorrect/generic response
    const remembersNumber = response2.includes(secretNumber);
    const admitsNotKnowing =
      response2.toLowerCase().includes("don't know") ||
      response2.toLowerCase().includes("do not know") ||
      response2.toLowerCase().includes("haven't told") ||
      response2.toLowerCase().includes("no secret") ||
      response2.toLowerCase().includes("not aware");

    // Either it doesn't remember, or it admits not knowing
    expect(remembersNumber === false || admitsNotKnowing).toBe(true);
  }, 120_000);

  test("should remember file operations across messages", async () => {
    // First message: Create a file
    const chunks1 = await collectChunks(
      provider.execute({
        prompt:
          'Create a file at /vercel/sandbox/session-test.txt with content "Session test content"',
        sandboxContext,
        model: TEST_MODEL,
      })
    );

    const sessionId = getSessionId(chunks1);
    expect(sessionId).toBeDefined();

    // Verify file was created
    const toolResults1 = findChunks(chunks1, "tool-result");
    const writeSuccess = toolResults1.some(
      (r) => r.output.includes("Wrote") || r.output.includes("bytes")
    );
    expect(writeSuccess).toBe(true);

    // Second message: Ask about the file we just created
    const chunks2 = await collectChunks(
      provider.execute({
        prompt: "What file did you just create? What was the path and content?",
        sandboxContext,
        sessionId,
        model: TEST_MODEL,
      })
    );

    const response2 = getFullText(chunks2);
    console.log("Response about file:", response2);

    // Should remember the file path and content without needing to read it again
    expect(response2.toLowerCase()).toContain("session-test.txt");
    expect(
      response2.toLowerCase().includes("session test content") ||
        response2.toLowerCase().includes("session-test")
    ).toBe(true);
  }, 120_000);

  test("session ID should be consistent within a session", async () => {
    // First message
    const chunks1 = await collectChunks(
      provider.execute({
        prompt: "Hello, start of conversation",
        sandboxContext,
        model: TEST_MODEL,
      })
    );

    const sessionId1 = getSessionId(chunks1);
    expect(sessionId1).toBeDefined();

    // Second message with same session
    const chunks2 = await collectChunks(
      provider.execute({
        prompt: "Continuing the conversation",
        sandboxContext,
        sessionId: sessionId1,
        model: TEST_MODEL,
      })
    );

    const sessionId2 = getSessionId(chunks2);
    expect(sessionId2).toBeDefined();

    // Session IDs should match
    expect(sessionId2).toBe(sessionId1);
  }, 90_000);
});
