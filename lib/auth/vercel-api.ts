/**
 * Vercel API Client
 *
 * Functions for interacting with Vercel's API using the official SDK.
 * These are used during session creation to populate user information.
 */

import { Vercel } from "@vercel/sdk";
import type { BillingPlan } from "./types";

/**
 * Create a Vercel SDK client with the given access token
 */
function createClient(accessToken: string): Vercel {
  return new Vercel({ bearerToken: accessToken });
}

/**
 * User data returned from the SDK, normalized for our use case
 */
export interface VercelUserData {
  id: string;
  username: string;
  email: string;
  name: string | null;
  avatar: string | null;
}

/**
 * Team data returned from the SDK, normalized for our use case
 */
export interface VercelTeamData {
  id: string;
  slug: string;
  name: string | null;
  membership: {
    role: string;
  };
}

/**
 * Fetch the authenticated user's profile from Vercel
 */
export async function fetchUser(
  accessToken: string
): Promise<VercelUserData | undefined> {
  try {
    const client = createClient(accessToken);
    const { user } = await client.user.getAuthUser();

    // Handle both AuthUser and AuthUserLimited types
    if ("id" in user) {
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name ?? null,
        avatar: user.avatar ?? null,
      };
    }

    return undefined;
  } catch (error) {
    console.error("[auth] Failed to fetch user:", error);
    return undefined;
  }
}

/**
 * Fetch the authenticated user's teams from Vercel
 */
export async function fetchTeams(
  accessToken: string
): Promise<VercelTeamData[] | undefined> {
  try {
    const client = createClient(accessToken);
    const { teams } = await client.teams.getTeams({});

    return teams.map((team) => {
      // Handle both Team and TeamLimited types
      if ("membership" in team) {
        return {
          id: team.id,
          slug: team.slug,
          name: team.name ?? null,
          membership: {
            role: team.membership.role,
          },
        };
      }
      // TeamLimited doesn't have membership, default to MEMBER
      return {
        id: team.id,
        slug: team.slug,
        name: team.name ?? null,
        membership: {
          role: "MEMBER",
        },
      };
    });
  } catch (error) {
    console.error("[auth] Failed to fetch teams:", error);
    return undefined;
  }
}

interface PlanInfo {
  plan: BillingPlan;
  teamId: string | null;
}

/**
 * Determine the highest billing plan from the user's team memberships.
 * Since the SDK doesn't expose billing info directly in getTeams,
 * we default to "hobby" for personal accounts.
 *
 * Note: For production use, you may want to fetch individual team
 * details to get billing information if plan-based features are needed.
 */
export function getHighestAccountLevel(teams: VercelTeamData[]): PlanInfo {
  // The SDK's Team type from getTeams doesn't include billing info
  // For a basic implementation, we check if user is on any team
  // and assume hobby plan for personal accounts

  if (!teams?.length) {
    return { plan: "hobby", teamId: null };
  }

  // If user is owner of any team, they likely have at least pro
  // This is a heuristic - for accurate billing info, you'd need
  // to call getTeam for each team individually
  const ownedTeam = teams.find((t) => t.membership.role === "OWNER");

  if (ownedTeam) {
    // Default to pro for team owners
    return { plan: "pro", teamId: ownedTeam.id };
  }

  // User is member of teams but not owner
  return { plan: "hobby", teamId: teams[0]?.id ?? null };
}
