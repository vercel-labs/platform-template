/**
 * @fileoverview Anthropic API proxy handler
 *
 * This proxy allows sandbox code to call the Anthropic API without having
 * access to real credentials. The sandbox sends requests with a session ID
 * as the "API key", and the proxy swaps it for the real OIDC token.
 */

import { sessionTokens } from "../store/session-tokens";

const UPSTREAM_BASE_URL = "https://ai-gateway.vercel.sh";

// Headers that should not be forwarded to upstream
const STRIPPED_HEADERS = new Set([
  "cookie",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "cf-connecting-ip",
  "cf-ray",
  "cf-ipcountry",
  "host",
]);

interface ProxyOptions {
  fetch?: typeof globalThis.fetch;
}

/**
 * Create a proxy handler with optional dependency injection
 */
export function createProxyHandler(options: ProxyOptions = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch;

  return async function handler(request: Request): Promise<Response> {
    // Extract authorization header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Parse session ID from Bearer token
    const sessionId = authHeader.replace(/^Bearer\s+/i, "");
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "Invalid authorization format" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Look up real token for this session (from Redis)
    const realToken = await sessionTokens.get(sessionId);
    if (!realToken) {
      return new Response(
        JSON.stringify({ error: "Invalid session ID" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build upstream URL - extract path after /api/anthropic
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/api\/anthropic(\/.*)/);
    const upstreamPath = pathMatch ? pathMatch[1] : "/v1/messages";
    const upstreamUrl = `${UPSTREAM_BASE_URL}${upstreamPath}`;

    // Build headers for upstream request
    const upstreamHeaders = new Headers();

    // Copy allowed headers from original request
    for (const [key, value] of request.headers.entries()) {
      if (!STRIPPED_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== "authorization") {
        upstreamHeaders.set(key, value);
      }
    }

    // Set the real authorization token
    upstreamHeaders.set("Authorization", `Bearer ${realToken}`);

    try {
      // Forward the request
      const upstreamResponse = await fetchFn(upstreamUrl, {
        method: request.method,
        headers: upstreamHeaders,
        body: request.body,
        // @ts-expect-error - duplex is needed for streaming request bodies
        duplex: "half",
      });

      // Forward the response headers
      const responseHeaders = new Headers();
      for (const [key, value] of upstreamResponse.headers.entries()) {
        // Don't forward certain headers
        if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
          responseHeaders.set(key, value);
        }
      }

      // Return the response, streaming if applicable
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      // Don't leak any internal details in error messages
      console.error("Proxy error:", error);
      return new Response(
        JSON.stringify({ error: "Proxy request failed" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
  };
}

/**
 * Default handler instance using global fetch
 */
export const proxyHandler = createProxyHandler();
