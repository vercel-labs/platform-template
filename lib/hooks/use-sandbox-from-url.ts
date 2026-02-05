"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSandboxStore } from "@/lib/store/sandbox-store";

/**
 * Hook that restores sandboxId from URL params.
 * Used to restore state after redirects (e.g., OAuth flow).
 * 
 * Reads `?sandboxId=xxx` from URL, sets it in the store, then cleans up the URL.
 */
export function useSandboxFromUrl() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const setSandbox = useSandboxStore((s) => s.setSandbox);
  const currentSandboxId = useSandboxStore((s) => s.sandboxId);

  useEffect(() => {
    const sandboxId = searchParams.get("sandboxId");
    if (!sandboxId || sandboxId === currentSandboxId) return;

    // Set sandbox ID - usePersistedChat will load the session from Redis
    setSandbox(sandboxId, "ready");

    // Clean up URL
    const url = new URL(window.location.href);
    url.searchParams.delete("sandboxId");
    router.replace(url.pathname + url.search, { scroll: false });
  }, [searchParams, setSandbox, currentSandboxId, router]);
}
