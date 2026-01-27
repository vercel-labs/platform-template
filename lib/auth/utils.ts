/**
 * Auth Utilities
 *
 * Helper functions for authentication flows.
 */

/**
 * Check if a URL is relative (safe for redirects)
 */
export function isRelativeUrl(url: string): boolean {
  try {
    new URL(url);
    return false;
  } catch {
    return true;
  }
}
