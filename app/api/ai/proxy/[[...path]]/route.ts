import { type NextRequest } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";
import { rateLimit, redis, type ProxySessionData } from "@/lib/redis";

export const maxDuration = 300;

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh";
const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "content-type",
  "anthropic-version",
]);

function getAllowedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return origin === request.nextUrl.origin ? origin : null;
}

function buildCorsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
}

async function handleRequest(request: NextRequest) {
  const origin = getAllowedOrigin(request);
  if (request.headers.get("origin") && !origin) {
    return new Response("Origin not allowed", { status: 403 });
  }

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
      },
    );
  }

  const data = await redis.get(`session:${sessionId}`);
  const session = data as ProxySessionData | null;

  if (!session) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired session" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const limitResult = await rateLimit(
    `rate:ai-proxy:${sessionId}`,
    10,
    60 * 60,
  );
  if (!limitResult.allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  const gatewayToken = await getVercelOidcToken();

  const url = new URL(request.url);
  const apiPath = url.pathname.replace(/^\/api\/ai\/proxy/, "");
  const targetUrl = `${AI_GATEWAY_URL}${apiPath}${url.search}`;

  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (ALLOWED_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  headers.set("x-api-key", gatewayToken);
  headers.set("authorization", `Bearer ${gatewayToken}`);

  const response = await fetch(targetUrl, {
    method: request.method,
    headers,
    body:
      request.method !== "GET" && request.method !== "HEAD"
        ? await request.arrayBuffer()
        : undefined,
  });

  const responseHeaders = new Headers(response.headers);
  const corsHeaders = buildCorsHeaders(origin);
  for (const [key, value] of Object.entries(corsHeaders)) {
    responseHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}

export async function GET(request: NextRequest) {
  return handleRequest(request);
}

export async function OPTIONS(request: NextRequest) {
  const origin = getAllowedOrigin(request);
  if (request.headers.get("origin") && !origin) {
    return new Response("Origin not allowed", { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...buildCorsHeaders(origin),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, x-api-key, Authorization, anthropic-version",
    },
  });
}
