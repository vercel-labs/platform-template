export const SESSION_COOKIE_NAME = "_user_session_";

export const SESSION_COOKIE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export const OAUTH_COOKIE_TTL_SECONDS = 60 * 10;

export const CSRF_COOKIE_NAME = "_csrf_token_";
export const CSRF_COOKIE_TTL_SECONDS = 60 * 60 * 24;

export const VERCEL_OAUTH = {
  authorize: "https://vercel.com/oauth/authorize",
  token: "https://vercel.com/api/login/oauth/token",
  revoke: "https://vercel.com/api/login/oauth/token/revoke",
} as const;

export const VERCEL_API = {
  user: "https://vercel.com/api/user",
  teams: "https://vercel.com/api/teams",
} as const;

export const OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
] as const;
