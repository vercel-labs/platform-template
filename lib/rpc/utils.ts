/**
 * Shared utilities for RPC procedures.
 * These helpers wrap common operations with typed Result errors.
 */

import { cookies } from "next/headers";
import { Sandbox } from "@vercel/sandbox";
import { Vercel } from "@vercel/sdk";
import { Result } from "better-result";
import { getSessionFromCookie, SESSION_COOKIE_NAME } from "@/lib/auth";
import { SandboxNotFoundError, ValidationError } from "@/lib/errors";
import {
  getProjectTokens,
  updateProjectTokens,
  tokensNeedRefresh,
  type ProjectTokens,
} from "@/lib/project-tokens";

export function getSandbox(sandboxId: string) {
  return Result.tryPromise({
    try: () => Sandbox.get({ sandboxId }),
    catch: () =>
      new SandboxNotFoundError({
        sandboxId,
        message: `Sandbox not found: ${sandboxId}`,
      }),
  });
}

/**
 * Get Vercel client using the signed-in user's OAuth token from session cookie.
 * Returns an error if user is not signed in.
 */
export async function getVercelClient() {
  const cookieStore = await cookies();
  const session = await getSessionFromCookie(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
  );

  if (!session?.tokens?.accessToken) {
    return Result.err(
      new ValidationError({ message: "Unauthorized - please sign in" }),
    );
  }

  return Result.ok(new Vercel({ bearerToken: session.tokens.accessToken }));
}

/**
 * Get Vercel client using the partner's service account token.
 * Used for initial deployments before user claims the project.
 * All requests should include teamId=VERCEL_PARTNER_TEAM_ID.
 */
export function getPartnerClient() {
  const token = process.env.VERCEL_PARTNER_TOKEN;
  const teamId = process.env.VERCEL_PARTNER_TEAM_ID;

  if (!token || !teamId) {
    console.error(
      "[partner-client] Missing env vars:",
      `VERCEL_PARTNER_TOKEN=${token ? "set" : "missing"}`,
      `VERCEL_PARTNER_TEAM_ID=${teamId ? "set" : "missing"}`,
    );
    return Result.err(
      new ValidationError({
        message: "Partner credentials not configured",
      }),
    );
  }

  return Result.ok({
    client: new Vercel({ bearerToken: token }),
    teamId,
  });
}

/**
 * Get Vercel client using stored project tokens.
 * Used for deployments after a user has claimed the project.
 * Will automatically refresh tokens if they're about to expire.
 */
export async function getProjectClient(projectId: string) {
  const tokens = await getProjectTokens(projectId);

  if (!tokens) {
    return Result.err(
      new ValidationError({
        message: "No tokens found for this project - user may need to re-authorize",
      }),
    );
  }

  // Check if tokens need refresh
  if (tokensNeedRefresh(tokens)) {
    const refreshResult = await refreshProjectTokens(tokens);
    if (refreshResult.isErr()) {
      return refreshResult;
    }
    return Result.ok(new Vercel({ bearerToken: refreshResult.value.accessToken }));
  }

  return Result.ok(new Vercel({ bearerToken: tokens.accessToken }));
}

/**
 * Refresh tokens for a project using the refresh token.
 * Updates the stored tokens and returns the new access token.
 */
async function refreshProjectTokens(tokens: ProjectTokens) {
  const clientId = process.env.VERCEL_CLIENT_ID;
  const clientSecret = process.env.VERCEL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return Result.err(
      new ValidationError({ message: "OAuth client not configured" }),
    );
  }

  const fetchResult = await Result.tryPromise({
    try: () =>
      fetch("https://vercel.com/api/login/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      }),
    catch: (err) =>
      new ValidationError({
        message: `Token refresh failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      }),
  });

  if (fetchResult.isErr()) {
    console.error("[refresh] Token refresh error:", fetchResult.error);
    return fetchResult;
  }

  const response = fetchResult.value;

  if (!response.ok) {
    const error = await response.text();
    console.error("[refresh] Token refresh failed:", error);

    // Check for invalid_grant which means user revoked access
    if (error.includes("invalid_grant")) {
      return Result.err(
        new ValidationError({
          message: "Access revoked - user needs to re-authorize",
        }),
      );
    }

    return Result.err(
      new ValidationError({ message: "Failed to refresh tokens" }),
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const newTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  // Update stored tokens
  await updateProjectTokens(tokens.projectId, newTokens);

  return Result.ok(newTokens);
}

/**
 * Check if the current user is signed in.
 */
export async function isUserSignedIn(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = await getSessionFromCookie(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
  );
  return !!session?.tokens?.accessToken;
}

/**
 * Get the current user's session (if signed in).
 */
export async function getCurrentSession() {
  const cookieStore = await cookies();
  return getSessionFromCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}
