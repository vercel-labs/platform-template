/**
 * Auth Constants
 *
 * Configuration constants for authentication.
 * Modify these values to customize the auth behavior.
 */

/** Cookie name for storing the encrypted user session */
export const SESSION_COOKIE_NAME = "_user_session_";

/** Session cookie TTL in milliseconds (1 year) */
export const SESSION_COOKIE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** OAuth state/verifier cookie TTL in seconds (10 minutes) */
export const OAUTH_COOKIE_TTL_SECONDS = 60 * 10;

/** Vercel OAuth endpoints */
export const VERCEL_OAUTH = {
  authorize: "https://vercel.com/oauth/authorize",
  token: "https://vercel.com/api/login/oauth/token",
  revoke: "https://vercel.com/api/login/oauth/token/revoke",
} as const;

/** Vercel API endpoints */
export const VERCEL_API = {
  user: "https://vercel.com/api/user",
  teams: "https://vercel.com/api/teams",
} as const;

/** OAuth scopes to request from Vercel */
export const OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
] as const;
