/**
 * Vercel OAuth Sign-In Route
 *
 * POST /api/auth/signin/vercel?next=/path
 *
 * Initiates the OAuth flow by generating state and PKCE verifier,
 * storing them in cookies, and returning the authorization URL.
 */

import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  CodeChallengeMethod,
  OAuth2Client,
  generateCodeVerifier,
  generateState,
} from "arctic";
import {
  VERCEL_OAUTH,
  OAUTH_SCOPES,
  OAUTH_COOKIE_TTL_SECONDS,
  isRelativeUrl,
} from "@/lib/auth";

export async function POST(req: NextRequest): Promise<Response> {
  const client = new OAuth2Client(
    process.env.VERCEL_CLIENT_ID ?? "",
    process.env.VERCEL_CLIENT_SECRET ?? "",
    `${req.nextUrl.origin}/api/auth/callback/vercel`
  );

  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = client.createAuthorizationURLWithPKCE(
    VERCEL_OAUTH.authorize,
    state,
    CodeChallengeMethod.S256,
    verifier,
    [...OAUTH_SCOPES]
  );

  const store = await cookies();
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const redirectTo = isRelativeUrl(next) ? next : "/";

  // Store OAuth state in temporary cookies
  for (const [key, value] of [
    ["vercel_oauth_redirect_to", redirectTo],
    ["vercel_oauth_state", state],
    ["vercel_oauth_code_verifier", verifier],
  ]) {
    store.set(key, value, {
      path: "/",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: OAUTH_COOKIE_TTL_SECONDS,
      sameSite: "lax",
    });
  }

  return Response.json({ url });
}
