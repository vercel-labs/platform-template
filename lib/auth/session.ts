import "server-only";

import type { NextRequest } from "next/server";
import type { Session, Tokens } from "./types";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_TTL_MS } from "./constants";
import { encryptJWE, decryptJWE } from "./jwe";
import { fetchUser, fetchTeams } from "./vercel-api";

export async function createSession(
  tokens: Tokens,
): Promise<Session | undefined> {
  const [user, teams] = await Promise.all([
    fetchUser(tokens.accessToken),
    fetchTeams(tokens.accessToken),
  ]);

  if (!user || !teams) {
    console.log("[auth] Failed to fetch user or teams");
    return undefined;
  }

  return {
    created: Date.now(),
    user: {
      avatar: `https://vercel.com/api/www/avatar/?u=${user.username}`,
      email: user.email,
      id: user.id,
      name: user.name ?? undefined,
      username: user.username,
    },
    tokens,
  };
}

export async function saveSession(
  res: Response,
  session: Session | undefined,
): Promise<string | undefined> {
  if (!session) {
    res.headers.append(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE_NAME, "", {
        expires: new Date(0),
        path: "/",
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
      }),
    );
    return;
  }

  const value = await encryptJWE(session, "1y");

  res.headers.append(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE_NAME, value, {
      path: "/",
      maxAge: SESSION_COOKIE_TTL_MS / 1000,
      expires: new Date(Date.now() + SESSION_COOKIE_TTL_MS),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    }),
  );

  return value;
}

export async function getSessionFromCookie(
  cookieValue?: string,
): Promise<Session | undefined> {
  if (!cookieValue) {
    return undefined;
  }

  const decrypted = await decryptJWE<Session>(cookieValue);
  if (!decrypted) {
    return undefined;
  }

  return {
    tokens: {
      accessToken: decrypted.tokens.accessToken,
      expiresAt: decrypted.tokens.expiresAt,
      refreshToken: decrypted.tokens.refreshToken,
    },
    created: decrypted.created,
    user: decrypted.user,
  };
}

export async function getSessionFromRequest(
  req: NextRequest,
): Promise<Session | undefined> {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  return getSessionFromCookie(cookieValue);
}

interface CookieOptions {
  path?: string;
  expires?: Date;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
}

function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

  if (options.path) {
    parts.push(`Path=${options.path}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  return parts.join("; ");
}
