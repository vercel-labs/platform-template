"use client";

import type { SessionUserInfo } from "@/lib/auth";
import { create } from "zustand";
import { useEffect } from "react";

interface SessionState {
  initialized: boolean;
  loading: boolean;
  user: SessionUserInfo["user"] | null;
  refresh: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  initialized: false,
  loading: true,
  user: null,
  refresh: async () => {
    set({ loading: true });
    try {
      const response = await fetch("/api/auth/info");
      const data: SessionUserInfo = await response.json();
      set({ initialized: true, loading: false, user: data.user ?? null });
    } catch {
      set({ initialized: true, loading: false, user: null });
    }
  },
}));

let resolveBotIdReady: () => void;
let botIdReadyPromise: Promise<void> = new Promise(
  (r) => (resolveBotIdReady = r),
);

/**
 * Returns a promise that resolves once the BotID session cookie has been
 * established. RPC calls should await this before firing to avoid 403s.
 */
export function waitForBotIdSession(): Promise<void> {
  return botIdReadyPromise;
}

async function ensureBotIdSession(): Promise<void> {
  try {
    await fetch("/api/botid/session", { method: "POST" });
    resolveBotIdReady();
  } catch {
    // Resolve anyway so we don't permanently block RPC calls -- the server
    // will still 403 if the session truly failed, and the next visibility
    // change will retry.
    resolveBotIdReady();
  }
}

export function SessionProvider() {
  const refresh = useSession((s) => s.refresh);

  useEffect(() => {
    refresh();
    ensureBotIdSession();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
        // Reset the gate so RPC calls wait for the refreshed session
        botIdReadyPromise = new Promise((r) => (resolveBotIdReady = r));
        ensureBotIdSession();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh]);

  return null;
}
