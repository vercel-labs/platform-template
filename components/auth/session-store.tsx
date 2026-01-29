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

export function SessionProvider() {
  const refresh = useSession((s) => s.refresh);

  useEffect(() => {
    refresh();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh]);

  return null;
}
