/**
 * AI Proxy Route
 *
 * Proxies requests to the Vercel AI Gateway.
 * Replaces the session ID in x-api-key header with the real OIDC token.
 */

import { getVercelOidcToken } from "@vercel/oidc";
import { redis, type SessionData } from "@/lib/redis";

export const maxDuration = 300;

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh";

async function handleRequest(request: Request) {
  // Check x-api-key header (used by Anthropic SDK / Claude CLI)
  // or Authorization: Bearer header (used by OpenAI SDK / Codex CLI)
  let sessionId = request.headers.get("x-api-key");

  if (!sessionId) {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      sessionId = authHeader.slice(7);
    }
  }

  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: "Missing x-api-key or Authorization header" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Look up session
  const data = await redis.get(`session:${sessionId}`);
  const session = data as SessionData | null;

  if (!session) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired session" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Build target URL
  const url = new URL(request.url);
  const apiPath = url.pathname.replace(/^\/api\/ai\/proxy/, "");
  const targetUrl = `${AI_GATEWAY_URL}${apiPath}${url.search}`;

  // Replace session ID with OIDC token
  const headers = new Headers(request.headers);
  const oidcToken = await getVercelOidcToken();

  // Set both headers - AI Gateway accepts either depending on the model provider
  // x-api-key is used by Anthropic, Authorization: Bearer is used by OpenAI
  headers.set("x-api-key", oidcToken);
  headers.set("authorization", `Bearer ${oidcToken}`);

  // Forward request
  const response = await fetch(targetUrl, {
    method: request.method,
    headers,
    body:
      request.method !== "GET" && request.method !== "HEAD"
        ? await request.arrayBuffer()
        : undefined,
  });

  // Stream response back
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export async function POST(request: Request) {
  return handleRequest(request);
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, x-api-key, Authorization, anthropic-version",
    },
  });
}
