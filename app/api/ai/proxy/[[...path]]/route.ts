
import { type NextRequest } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";
import { redis, type SessionData } from "@/lib/redis";

export const maxDuration = 300;

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh";

async function handleRequest(request: NextRequest) {
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

  const data = await redis.get(`session:${sessionId}`);
  const session = data as SessionData | null;

  if (!session) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired session" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const gatewayToken = session.accessToken ?? await getVercelOidcToken();

  const url = new URL(request.url);
  const apiPath = url.pathname.replace(/^\/api\/ai\/proxy/, "");
  const targetUrl = `${AI_GATEWAY_URL}${apiPath}${url.search}`;

  const headers = new Headers(request.headers);

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
