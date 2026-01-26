/**
 * @fileoverview Anthropic API proxy route
 *
 * Catches all requests to /api/anthropic/* and proxies them to the
 * Vercel AI Gateway, swapping session IDs for real OIDC tokens.
 */

import { proxyHandler } from "@/lib/api/anthropic-proxy";

export const runtime = "edge";

export async function POST(request: Request) {
  return proxyHandler(request);
}

// Support other methods that the Anthropic API might use
export async function GET(request: Request) {
  return proxyHandler(request);
}
