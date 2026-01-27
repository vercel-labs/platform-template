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

export interface SessionUserInfo {
  user: User | undefined;
}
