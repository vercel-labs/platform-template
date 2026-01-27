/**
 * Auth Types
 *
 * Type definitions for Vercel OAuth authentication.
 * This module is designed to be easily customizable for different OAuth providers.
 */

// ============================================================================
// Session Types
// ============================================================================

export interface Session {
  created: number;
  tokens: Tokens;
  user: User;
}

export interface Tokens {
  accessToken: string;
  expiresAt?: number;
  refreshToken?: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatar: string;
  name?: string;
  plan: BillingPlan;
  highestTeamId?: string;
}

export type BillingPlan = "hobby" | "pro" | "enterprise";

// ============================================================================
// API Response Types
// ============================================================================

export interface SessionUserInfo {
  user: User | undefined;
}
