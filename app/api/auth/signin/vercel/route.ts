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

/**
 * OAuth Sign-in Route (Claim Flow)
 *
 * Sign-in is only triggered via the claim deployment flow which accepts:
 * - transfer_code: Transfer code from createTransferRequest (triggers project claim)
 * - project_id: Project being claimed (stored for callback to link tokens)
 * - next: Redirect URL after sign-in
 *
 * GET: Redirects directly to Vercel OAuth
 */
export async function GET(req: NextRequest): Promise<Response> {
  const client = new OAuth2Client(
    process.env.VERCEL_CLIENT_ID ?? "",
    process.env.VERCEL_CLIENT_SECRET ?? "",
    `${req.nextUrl.origin}/api/auth/callback/vercel`,
  );

  const state = generateState();
  const verifier = generateCodeVerifier();

  // Create the base authorization URL
  const url = client.createAuthorizationURLWithPKCE(
    VERCEL_OAUTH.authorize,
    state,
    CodeChallengeMethod.S256,
    verifier,
    [...OAUTH_SCOPES],
  );

  // Check for transfer_code (claim deployment flow)
  const transferCode = req.nextUrl.searchParams.get("transfer_code");
  const projectId = req.nextUrl.searchParams.get("project_id");

  if (transferCode) {
    // Add transfer_code to the OAuth URL to trigger claim during authorization
    url.searchParams.set("transfer_code", transferCode);
  }

  const store = await cookies();
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const redirectTo = isRelativeUrl(next) ? next : "/";

  // Store OAuth state cookies
  const cookiesToSet: [string, string][] = [
    ["vercel_oauth_redirect_to", redirectTo],
    ["vercel_oauth_state", state],
    ["vercel_oauth_code_verifier", verifier],
  ];

  // Store project_id if this is a claim flow (used in callback to link tokens)
  if (projectId) {
    cookiesToSet.push(["vercel_oauth_project_id", projectId]);
  }

  for (const [key, value] of cookiesToSet) {
    store.set(key, value, {
      path: "/",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: OAUTH_COOKIE_TTL_SECONDS,
      sameSite: "lax",
    });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
    },
  });
}
