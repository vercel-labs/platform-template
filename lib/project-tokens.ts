/**
 * Project Token Storage
 *
 * Stores OAuth tokens (access + refresh) per project for the claim deployment flow.
 * When a user claims a project, their tokens are stored here so the platform can
 * continue making updates on their behalf.
 *
 * Storage keys:
 * - `project-tokens:{projectId}` - Primary lookup by project
 * - `user-projects:{userId}` - Index of projects a user has claimed
 */

import { Result } from "better-result";
import { redis } from "./redis";

export interface ProjectTokens {
  projectId: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (ms) when access token expires
  createdAt: number;
  updatedAt: number;
  transferredAt?: number; // When the project was claimed/transferred
}

const PROJECT_TOKENS_PREFIX = "project-tokens:";
const USER_PROJECTS_PREFIX = "user-projects:";

// Tokens are stored for 1 year - they should be refreshed periodically
const TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

/**
 * Store tokens for a project after a user claims it
 */
export async function storeProjectTokens(
  tokens: Omit<ProjectTokens, "createdAt" | "updatedAt">,
): Promise<void> {
  const now = Date.now();
  const data: ProjectTokens = {
    ...tokens,
    createdAt: now,
    updatedAt: now,
  };

  // Store the tokens keyed by project
  await redis.set(
    `${PROJECT_TOKENS_PREFIX}${tokens.projectId}`,
    JSON.stringify(data),
    { ex: TOKEN_TTL_SECONDS },
  );

  // Add to the user's project index
  await redis.sadd(`${USER_PROJECTS_PREFIX}${tokens.userId}`, tokens.projectId);
}

/**
 * Get tokens for a project
 */
export async function getProjectTokens(
  projectId: string,
): Promise<ProjectTokens | null> {
  const data = await redis.get(`${PROJECT_TOKENS_PREFIX}${projectId}`);
  if (!data) return null;

  if (typeof data !== "string") {
    return data as ProjectTokens;
  }

  const parseResult = Result.try({
    try: () => JSON.parse(data) as ProjectTokens,
    catch: (err) =>
      err instanceof Error ? err.message : "Failed to parse token data",
  });

  if (parseResult.isErr()) {
    console.error("[project-tokens] Failed to parse token data:", parseResult.error);
    return null;
  }

  return parseResult.value;
}

/**
 * Update tokens for a project (e.g., after refresh)
 */
export async function updateProjectTokens(
  projectId: string,
  tokens: { accessToken: string; refreshToken: string; expiresAt: number },
): Promise<boolean> {
  const existing = await getProjectTokens(projectId);
  if (!existing) return false;

  const updated: ProjectTokens = {
    ...existing,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    updatedAt: Date.now(),
  };

  await redis.set(
    `${PROJECT_TOKENS_PREFIX}${projectId}`,
    JSON.stringify(updated),
    { ex: TOKEN_TTL_SECONDS },
  );

  return true;
}

/**
 * Delete tokens for a project (e.g., if user revokes access)
 */
export async function deleteProjectTokens(projectId: string): Promise<void> {
  const existing = await getProjectTokens(projectId);
  if (existing) {
    await redis.srem(
      `${USER_PROJECTS_PREFIX}${existing.userId}`,
      projectId,
    );
  }
  await redis.del(`${PROJECT_TOKENS_PREFIX}${projectId}`);
}

/**
 * Get all project IDs a user has claimed
 */
export async function getUserProjects(userId: string): Promise<string[]> {
  const projects = await redis.smembers(`${USER_PROJECTS_PREFIX}${userId}`);
  return projects as string[];
}

/**
 * Check if a project has been claimed (has stored tokens)
 */
export async function isProjectClaimed(projectId: string): Promise<boolean> {
  const tokens = await getProjectTokens(projectId);
  return tokens !== null && tokens.transferredAt !== undefined;
}

/**
 * Mark a project as transferred (claimed by user)
 */
export async function markProjectTransferred(projectId: string): Promise<boolean> {
  const existing = await getProjectTokens(projectId);
  if (!existing) return false;

  const updated: ProjectTokens = {
    ...existing,
    transferredAt: Date.now(),
    updatedAt: Date.now(),
  };

  await redis.set(
    `${PROJECT_TOKENS_PREFIX}${projectId}`,
    JSON.stringify(updated),
    { ex: TOKEN_TTL_SECONDS },
  );

  return true;
}

/**
 * Check if tokens need to be refreshed (with 5 minute buffer)
 */
export function tokensNeedRefresh(tokens: ProjectTokens): boolean {
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return Date.now() >= tokens.expiresAt - bufferMs;
}
