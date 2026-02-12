"use client";

export async function redirectToSignOut(): Promise<void> {
  const response = await fetch(
    `/api/auth/signout?${new URLSearchParams({
      next: window.location.pathname,
    }).toString()}`,
  );

  const { url } = await response.json();
  window.location = url;

  if (window.location.hash) {
    window.location.reload();
  }
}
