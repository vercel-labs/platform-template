/**
 * Auth Client Utilities
 *
 * Client-side functions for authentication flows.
 * These are safe to use in "use client" components.
 */

"use client";

/**
 * Redirect to Vercel OAuth sign-in
 */
export async function redirectToSignIn(): Promise<void> {
  const response = await fetch(
    `/api/auth/signin/vercel?${new URLSearchParams({
      next: window.location.pathname,
    }).toString()}`,
    { method: "POST" }
  );

  const { url } = await response.json();
  window.location = url;

  // Force reload if there's a hash (prevents some edge cases)
  if (window.location.hash) {
    window.location.reload();
  }
}

/**
 * Sign out and redirect
 */
export async function redirectToSignOut(): Promise<void> {
  const response = await fetch(
    `/api/auth/signout?${new URLSearchParams({
      next: window.location.pathname,
    }).toString()}`
  );

  const { url } = await response.json();
  window.location = url;

  if (window.location.hash) {
    window.location.reload();
  }
}
