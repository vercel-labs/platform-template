"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useSandboxStore } from "@/lib/store/sandbox-store";

/**
 * Hook that restores sandboxId from URL params.
 * Used to restore state after redirects (e.g., OAuth flow) or when
 * returning to a bookmarked/shared conversation URL.
 *
 * Reads `?sandboxId=xxx` from URL and sets it in the store.
 * usePersistedChat will then load the session from Redis.
 */
export function useSandboxFromUrl() {
  const searchParams = useSearchParams();
  const setSandbox = useSandboxStore((s) => s.setSandbox);
  const currentSandboxId = useSandboxStore((s) => s.sandboxId);

  useEffect(() => {
    const sandboxId = searchParams.get("sandboxId");
    if (!sandboxId || sandboxId === currentSandboxId) return;

    // Set sandbox ID - usePersistedChat will load the session from Redis
    setSandbox(sandboxId, "ready");
  }, [searchParams, setSandbox, currentSandboxId]);
}
