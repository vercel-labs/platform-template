/**
 * @fileoverview Tests for the Anthropic API proxy
 *
 * The proxy allows sandbox code to call the Anthropic API without having
 * access to real credentials. Instead:
 * 1. Sandbox sends requests with a session ID as the "API key"
 * 2. Proxy looks up the real OIDC token for that session
 * 3. Proxy forwards the request to Vercel AI Gateway with the real token
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the session store before importing the handler
const mockSessionStore = new Map<string, string>();

vi.mock("../../store/session-tokens", () => ({
  sessionTokens: {
    get: (sessionId: string) => mockSessionStore.get(sessionId),
    set: (sessionId: string, token: string) => mockSessionStore.set(sessionId, token),
    delete: (sessionId: string) => mockSessionStore.delete(sessionId),
  },
}));

// Import after mocking
import { createProxyHandler } from "../../api/anthropic-proxy";

describe("Anthropic Proxy", () => {
  let handler: ReturnType<typeof createProxyHandler>;
  let mockFetch: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    mockSessionStore.clear();
    mockFetch = vi.fn<typeof fetch>();
    handler = createProxyHandler({ fetch: mockFetch });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("should reject requests without authorization header", async () => {
      const request = new Request("http://localhost:3000/api/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "claude-3-haiku", messages: [] }),
      });

      const response = await handler(request);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toContain("Missing authorization");
    });

    test("should reject requests with invalid session ID", async () => {
      const request = new Request("http://localhost:3000/api/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer invalid-session-id",
        },
        body: JSON.stringify({ model: "claude-3-haiku", messages: [] }),
      });

      const response = await handler(request);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toContain("Invalid session");
    });

    test("should accept requests with valid session ID", async () => {
      const sessionId = "session-123";
      const realToken = "real-oidc-token-xyz";
      mockSessionStore.set(sessionId, realToken);

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "msg_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = new Request("http://localhost:3000/api/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionId}`,
        },
        body: JSON.stringify({ model: "claude-3-haiku", messages: [] }),
      });

      const response = await handler(request);

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("Request Forwarding", () => {
    test("should forward request to Vercel AI Gateway", async () => {
      const sessionId = "session-456";
      const realToken = "real-oidc-token-abc";
      mockSessionStore.set(sessionId, realToken);

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "msg_456" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const requestBody = {
        model: "claude-3-haiku",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 100,
      };

      const request = new Request("http://localhost:3000/api/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionId}`,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(requestBody),
      });

      await handler(request);

      // Verify URL and method
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://ai-gateway.vercel.sh/v1/messages");
      expect(fetchOptions.method).toBe("POST");

      // Check the forwarded headers - should have real token, not session ID
      const headers = fetchOptions.headers as Headers;
      expect(headers.get("Authorization")).toBe(`Bearer ${realToken}`);
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(headers.get("Content-Type")).toBe("application/json");

      // Body is passed as a stream, verify it's present
      expect(fetchOptions.body).toBeDefined();
    });

    test("should preserve path after /api/anthropic", async () => {
      const sessionId = "session-789";
      mockSessionStore.set(sessionId, "token");

      mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));

      const request = new Request("http://localhost:3000/api/anthropic/v1/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionId}`,
        },
        body: "{}",
      });

      await handler(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://ai-gateway.vercel.sh/v1/complete",
        expect.anything()
      );
    });
  });

  describe("Response Handling", () => {
    test("should forward successful response", async () => {
      const sessionId = "session-success";
      mockSessionStore.set(sessionId, "token");

      const responseBody = {
        id: "msg_success",
        type: "message",
        content: [{ type: "text", text: "Hello!" }],
      };

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = new Request("http://localhost:3000/api/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionId}`,
        },
        body: JSON.stringify({ model: "claude-3-haiku", messages: [] }),
      });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(responseBody);
    });

    test("should forward error responses from upstream", async () => {
      const sessionId = "session-error";
      mockSessionStore.set(sessionId, "token");

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { type: "invalid_request", message: "Bad request" } }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      );

      const request = new Request("http://localhost:3000/api/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionId}`,
        },
        body: JSON.stringify({}),
      });

      const response = await handler(request);

      expect(response.status).toBe(400);
    });

    test("should handle streaming responses", async () => {
      const sessionId = "session-stream";
      mockSessionStore.set(sessionId, "token");

      // Create a streaming response
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("event: message_start\n"));
          controller.enqueue(encoder.encode('data: {"type":"message_start"}\n\n'));
          controller.enqueue(encoder.encode("event: content_block_delta\n"));
          controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n'));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      );

      const request = new Request("http://localhost:3000/api/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionId}`,
        },
        body: JSON.stringify({ stream: true }),
      });

      const response = await handler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");

      // Read the stream
      const reader = response.body!.getReader();
      const chunks: string[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(new TextDecoder().decode(value));
      }

      const fullResponse = chunks.join("");
      expect(fullResponse).toContain("message_start");
      expect(fullResponse).toContain("content_block_delta");
    });
  });

  describe("Security", () => {
    test("should not leak real token in error messages", async () => {
      const sessionId = "session-leak-test";
      const realToken = "super-secret-token-do-not-leak";
      mockSessionStore.set(sessionId, realToken);

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const request = new Request("http://localhost:3000/api/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionId}`,
        },
        body: JSON.stringify({}),
      });

      const response = await handler(request);
      const text = await response.text();

      expect(text).not.toContain(realToken);
    });

    test("should strip sensitive headers from forwarded request", async () => {
      const sessionId = "session-headers";
      mockSessionStore.set(sessionId, "token");

      mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));

      const request = new Request("http://localhost:3000/api/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionId}`,
          "Cookie": "session=abc123",
          "X-Forwarded-For": "192.168.1.1",
        },
        body: "{}",
      });

      await handler(request);

      const [, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = fetchOptions.headers as Headers;

      // Should not forward cookies or forwarded headers
      expect(headers.has("Cookie")).toBe(false);
      expect(headers.has("X-Forwarded-For")).toBe(false);
    });
  });
});
