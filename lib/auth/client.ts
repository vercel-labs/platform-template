"use client";

function getCookieValue(name: string): string | undefined {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : undefined;
}

export async function redirectToSignOut(): Promise<void> {
  let csrfToken = getCookieValue("_csrf_token_");
  if (!csrfToken) {
    try {
      const info = await fetch("/api/auth/info");
      const data = (await info.json()) as { csrfToken?: string };
      csrfToken = data.csrfToken;
    } catch {
      csrfToken = undefined;
    }
  }
  const response = await fetch("/api/auth/signout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
    body: JSON.stringify({ next: window.location.pathname }),
  });

  const { url } = await response.json();
  window.location = url;

  if (window.location.hash) {
    window.location.reload();
  }
}
