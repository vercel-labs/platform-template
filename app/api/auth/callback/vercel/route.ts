import { type NextRequest } from "next/server";
import { OAuth2Client, type OAuth2Tokens } from "arctic";
import { cookies } from "next/headers";
import { Result } from "better-result";
import { VERCEL_OAUTH, createSession, saveSession } from "@/lib/auth";
import { storeProjectTokens } from "@/lib/project-tokens";
import { getSandboxSession, saveSandboxSession } from "@/lib/chat-history";

/**
 * OAuth Callback Route
 *
 * Handles the OAuth callback after user authorization.
 * For claim deployment flow:
 * - Captures refresh_token (required for ongoing access)
 * - Stores tokens linked to the project being claimed
 * - Marks project as transferred
 */
export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();

  const storedState = cookieStore.get("vercel_oauth_state")?.value ?? null;
  const storedVerifier =
    cookieStore.get("vercel_oauth_code_verifier")?.value ?? null;
  const storedRedirectTo =
    cookieStore.get("vercel_oauth_redirect_to")?.value ?? "/";
  const storedProjectId =
    cookieStore.get("vercel_oauth_project_id")?.value ?? null;

  if (
    code === null ||
    state === null ||
    storedState !== state ||
    storedVerifier === null
  ) {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  const client = new OAuth2Client(
    process.env.VERCEL_CLIENT_ID ?? "",
    process.env.VERCEL_CLIENT_SECRET ?? "",
    `${req.nextUrl.origin}/api/auth/callback/vercel`,
  );

  const tokensResult = await Result.tryPromise({
    try: () =>
      client.validateAuthorizationCode(VERCEL_OAUTH.token, code, storedVerifier),
    catch: (err) =>
      err instanceof Error ? err.message : "Failed to exchange code for tokens",
  });

  if (tokensResult.isErr()) {
    console.error("[auth] Failed to exchange code for tokens:", tokensResult.error);
    return new Response("Failed to authenticate", { status: 400 });
  }

  const tokens = tokensResult.value;

  // Extract token values - including refresh token!
  const accessToken = tokens.accessToken();
  const expiresAt = tokens.accessTokenExpiresAt().getTime();
  // The arctic library provides refreshToken() method if offline_access scope was requested
  const refreshToken = tokens.refreshToken?.() ?? undefined;

  const response = new Response(null, {
    status: 302,
    headers: {
      Location: storedRedirectTo,
    },
  });

  // Create user session (for regular auth)
  const session = await createSession({
    accessToken,
    expiresAt,
    refreshToken,
  });

  await saveSession(response, session);

  // If this is a claim flow, store tokens linked to the project
  if (storedProjectId && session?.user) {
    const storeResult = await Result.tryPromise({
      try: () =>
        storeProjectTokens({
          projectId: storedProjectId,
          userId: session.user!.id,
          accessToken,
          refreshToken: refreshToken || "",
          expiresAt,
          transferredAt: Date.now(), // Mark as transferred immediately
        }),
      catch: (err) =>
        err instanceof Error ? err.message : "Failed to store project tokens",
    });

    if (storeResult.isErr()) {
      // Log but don't fail the auth flow
      console.error("[auth] Failed to store project tokens:", storeResult.error);
    } else {
      console.log(
        `[auth] Stored project tokens for project ${storedProjectId}, user ${session.user.id}`,
      );

      // Update the Redis session ownership so the UI reflects the claim
      try {
        const redirectUrl = new URL(storedRedirectTo, req.nextUrl.origin);
        const sandboxId = redirectUrl.searchParams.get("sandboxId");
        if (sandboxId) {
          const existing = await getSandboxSession(sandboxId);
          if (existing && existing.projectId === storedProjectId) {
            await saveSandboxSession(sandboxId, {
              ...existing,
              projectOwnership: "user",
            });
          }
        }
      } catch (err) {
        console.warn("[auth] Failed to update session ownership:", err);
      }
    }
  }

  // Clean up OAuth cookies
  cookieStore.delete("vercel_oauth_state");
  cookieStore.delete("vercel_oauth_code_verifier");
  cookieStore.delete("vercel_oauth_redirect_to");
  if (storedProjectId) {
    cookieStore.delete("vercel_oauth_project_id");
  }

  return response;
}
