/**
 * @fileoverview In-memory store for session ID → OIDC token mapping
 *
 * This store maps session IDs (which are safe to expose to sandboxes) to
 * real OIDC tokens (which must be kept secret). The proxy uses this to
 * authenticate requests from sandboxes without exposing real credentials.
 *
 * Note: This is an in-memory store, so tokens are lost on server restart.
 * For production, consider using Redis or a similar persistent store.
 */

class SessionTokenStore {
  private tokens = new Map<string, string>();

  /**
   * Store a token for a session
   */
  set(sessionId: string, token: string): void {
    this.tokens.set(sessionId, token);
  }

  /**
   * Get the token for a session
   */
  get(sessionId: string): string | undefined {
    return this.tokens.get(sessionId);
  }

  /**
   * Remove a session's token
   */
  delete(sessionId: string): boolean {
    return this.tokens.delete(sessionId);
  }

  /**
   * Check if a session exists
   */
  has(sessionId: string): boolean {
    return this.tokens.has(sessionId);
  }

  /**
   * Clear all tokens (useful for testing)
   */
  clear(): void {
    this.tokens.clear();
  }
}

// Export singleton instance
export const sessionTokens = new SessionTokenStore();
