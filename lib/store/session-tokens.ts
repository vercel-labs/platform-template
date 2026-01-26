/**
 * @fileoverview Redis store for session ID → OIDC token mapping
 *
 * This store maps session IDs (which are safe to expose to sandboxes) to
 * real OIDC tokens (which must be kept secret). The proxy uses this to
 * authenticate requests from sandboxes without exposing real credentials.
 *
 * Uses Redis for persistence across server restarts and horizontal scaling.
 * Session tokens expire after 12 hours.
 */

const REDIS_URL = process.env.REDIS_URL || process.env.KV_URL;
const KEY_PREFIX = "session:";
const TTL_SECONDS = 12 * 60 * 60; // 12 hours

// Use Upstash REST API since we're in Next.js Edge Runtime
// Bun.redis doesn't work in Edge Runtime
class SessionTokenStore {
  private baseUrl: string;
  private token: string;

  constructor() {
    const restUrl = process.env.KV_REST_API_URL;
    const restToken = process.env.KV_REST_API_TOKEN;

    if (!restUrl || !restToken) {
      console.warn(
        "[session-tokens] KV_REST_API_URL or KV_REST_API_TOKEN not set, falling back to in-memory store"
      );
    }

    this.baseUrl = restUrl || "";
    this.token = restToken || "";
  }

  private get isConfigured(): boolean {
    return Boolean(this.baseUrl && this.token);
  }

  // In-memory fallback for development without Redis
  private fallbackStore = new Map<string, string>();

  private async request(
    command: string[]
  ): Promise<{ result: string | number | null } | null> {
    if (!this.isConfigured) return null;

    try {
      const response = await fetch(`${this.baseUrl}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
      });

      if (!response.ok) {
        console.error(
          `[session-tokens] Redis error: ${response.status} ${response.statusText}`
        );
        return null;
      }

      return response.json();
    } catch (error) {
      console.error("[session-tokens] Redis request failed:", error);
      return null;
    }
  }

  /**
   * Store a token for a session with TTL
   */
  async set(sessionId: string, token: string): Promise<void> {
    const key = `${KEY_PREFIX}${sessionId}`;

    if (this.isConfigured) {
      await this.request(["SET", key, token, "EX", String(TTL_SECONDS)]);
    } else {
      this.fallbackStore.set(sessionId, token);
    }
  }

  /**
   * Get the token for a session
   */
  async get(sessionId: string): Promise<string | undefined> {
    const key = `${KEY_PREFIX}${sessionId}`;

    if (this.isConfigured) {
      const result = await this.request(["GET", key]);
      return typeof result?.result === "string" ? result.result : undefined;
    } else {
      return this.fallbackStore.get(sessionId);
    }
  }

  /**
   * Remove a session's token
   */
  async delete(sessionId: string): Promise<boolean> {
    const key = `${KEY_PREFIX}${sessionId}`;

    if (this.isConfigured) {
      const result = await this.request(["DEL", key]);
      return result?.result !== null;
    } else {
      return this.fallbackStore.delete(sessionId);
    }
  }

  /**
   * Check if a session exists
   */
  async has(sessionId: string): Promise<boolean> {
    const key = `${KEY_PREFIX}${sessionId}`;

    if (this.isConfigured) {
      const result = await this.request(["EXISTS", key]);
      return result?.result === "1" || result?.result === 1;
    } else {
      return this.fallbackStore.has(sessionId);
    }
  }

  /**
   * Clear all session tokens (useful for testing)
   */
  async clear(): Promise<void> {
    if (this.isConfigured) {
      // Note: This only works in development. In production, use SCAN + DEL
      console.warn(
        "[session-tokens] clear() not fully implemented for Redis"
      );
    } else {
      this.fallbackStore.clear();
    }
  }
}

// Export singleton instance
export const sessionTokens = new SessionTokenStore();
