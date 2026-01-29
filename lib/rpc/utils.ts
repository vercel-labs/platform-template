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

/** Get sandbox by ID, returns Result with typed error */
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

/** Get authenticated Vercel SDK client from session cookie */
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
