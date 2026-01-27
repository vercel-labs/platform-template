/**
 * Auth Module
 *
 * Vercel OAuth authentication with encrypted session storage.
 *
 * ## Setup
 *
 * 1. Add environment variables:
 *    - VERCEL_CLIENT_ID: OAuth client ID from Vercel
 *    - VERCEL_CLIENT_SECRET: OAuth client secret from Vercel
 *    - JWE_SECRET: Base64-encoded 256-bit key for session encryption
 *      Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
 *
 * 2. Create OAuth routes (see app/api/auth/ for examples)
 *
 * 3. Add auth UI components to your layout
 *
 * ## Customization
 *
 * To adapt this for a different OAuth provider:
 * - Modify constants.ts with your provider's endpoints
 * - Update vercel-api.ts with your provider's API calls
 * - Adjust types.ts for your user data structure
 */

// Types
export type {
  Session,
  Tokens,
  User,
  BillingPlan,
  SessionUserInfo,
} from "./types";

export type {
  VercelUserData,
  VercelTeamData,
} from "./vercel-api";

// Constants
export {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_TTL_MS,
  OAUTH_COOKIE_TTL_SECONDS,
  VERCEL_OAUTH,
  VERCEL_API,
  OAUTH_SCOPES,
} from "./constants";

// JWE
export { encryptJWE, decryptJWE } from "./jwe";

// Session Management
export {
  createSession,
  saveSession,
  getSessionFromCookie,
  getSessionFromRequest,
} from "./session";

// Vercel API
export { fetchUser, fetchTeams, getHighestAccountLevel } from "./vercel-api";

// Utilities
export { isRelativeUrl } from "./utils";
