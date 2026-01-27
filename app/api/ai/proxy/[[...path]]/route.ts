/**
 * AI Proxy Route
 *
 * Proxies requests to the Vercel AI Gateway.
 *
 * Authentication strategy:
 * 1. If the session has a userId (authenticated user), use their Vercel access token
 *    from the auth cookie - this bills to their AI gateway credits
 * 2. Otherwise, fall back to OIDC token (bills to the app's Vercel account)
 */

import { type NextRequest } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";
import { redis, type SessionData } from "@/lib/redis";
import { getSessionFromRequest } from "@/lib/auth";

export const maxDuration = 300;

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh";

async function handleRequest(request: NextRequest) {
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

  // Look up session from Redis
  const data = await redis.get(`session:${sessionId}`);
  const session = data as SessionData | null;

  if (!session) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired session" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Determine which token to use for AI Gateway
  let gatewayToken: string;

  if (session.userId) {
    // Session belongs to an authenticated user - use their access token
    const authSession = await getSessionFromRequest(request);

    if (authSession?.user?.id === session.userId && authSession.tokens.accessToken) {
      // User's auth cookie matches the session - use their token
      gatewayToken = authSession.tokens.accessToken;
    } else {
      // Auth cookie missing or doesn't match - fall back to OIDC
      // This can happen if user signed out or cookie expired
      console.warn(
        "[proxy] Session has userId but auth cookie mismatch, falling back to OIDC"
      );
      gatewayToken = await getVercelOidcToken();
    }
  } else {
    // Anonymous session - use OIDC token
    gatewayToken = await getVercelOidcToken();
  }

  // Build target URL
  const url = new URL(request.url);
  const apiPath = url.pathname.replace(/^\/api\/ai\/proxy/, "");
  const targetUrl = `${AI_GATEWAY_URL}${apiPath}${url.search}`;

  // Set up headers with the gateway token
  const headers = new Headers(request.headers);

  // Set both headers - AI Gateway accepts either depending on the model provider
  // x-api-key is used by Anthropic, Authorization: Bearer is used by OpenAI
  headers.set("x-api-key", gatewayToken);
  headers.set("authorization", `Bearer ${gatewayToken}`);

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

export async function POST(request: NextRequest) {
  return handleRequest(request);
}

export async function GET(request: NextRequest) {
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
