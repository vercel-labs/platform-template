import { Vercel } from "@vercel/sdk";

function createClient(accessToken: string): Vercel {
  return new Vercel({ bearerToken: accessToken });
}

export interface VercelUserData {
  id: string;
  username: string;
  email: string;
  name: string | null;
  avatar: string | null;
}

export interface VercelTeamData {
  id: string;
  slug: string;
  name: string | null;
  membership: {
    role: string;
  };
}

export async function fetchUser(
  accessToken: string,
): Promise<VercelUserData | undefined> {
  try {
    const client = createClient(accessToken);
    const response = await client.user.getAuthUser();

    if (!response) return undefined;

    const { user } = response;

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

export async function fetchTeams(
  accessToken: string,
): Promise<VercelTeamData[] | undefined> {
  try {
    const client = createClient(accessToken);
    const response = await client.teams.getTeams({});

    if (!response) return undefined;

    const { teams } = response;

    return teams.map((team) => ({
      id: team.id,
      slug: team.slug,
      name: team.name ?? null,
      membership: {
        role: "membership" in team ? team.membership.role : "MEMBER",
      },
    }));
  } catch (error) {
    console.error("[auth] Failed to fetch teams:", error);
    return undefined;
  }
}
