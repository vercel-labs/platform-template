"use client";

import { useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import { rpc } from "@/lib/rpc/client";
import { useSandboxStore } from "@/lib/store/sandbox-store";

type MessagePart =
  | { type: "text"; content: string }
  | {
      type: "tool";
      id: string;
      name: string;
      input: string;
      output?: string;
      isError?: boolean;
      state: "streaming" | "done";
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
}

interface SessionData {
  messages: ChatMessage[];
  previewUrl?: string;
}

async function fetchSession(sandboxId: string): Promise<SessionData | null> {
  const result = await rpc.sandbox.getSession({ sandboxId });
  if (result.isOk() && result.value.session) {
    return result.value.session as SessionData;
  }
  return null;
}

/**
 * Hook for managing chat messages with Redis persistence.
 *
 * This hook is READ-ONLY for persistence - it loads messages from Redis
 * but does NOT save them. Persistence is handled server-side in the
 * chat RPC procedure after streaming completes.
 *
 * The setMessages function only updates the local SWR cache for
 * optimistic UI updates during streaming.
 */
export function usePersistedChat() {
  const sandboxId = useSandboxStore((s) => s.sandboxId);
  const setPreviewUrl = useSandboxStore((s) => s.setPreviewUrl);

  // Fetch session from Redis
  const { data, isLoading, mutate } = useSWR(
    sandboxId ? ["sandbox-session", sandboxId] : null,
    ([, id]) => fetchSession(id),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );

  // Restore previewUrl when session loads
  const hasRestoredPreview = useRef(false);
  useEffect(() => {
    if (data?.previewUrl && !hasRestoredPreview.current) {
      setPreviewUrl(data.previewUrl);
      hasRestoredPreview.current = true;
    }
  }, [data?.previewUrl, setPreviewUrl]);

  // Reset restore flag when sandboxId changes
  const prevSandboxId = useRef(sandboxId);
  if (sandboxId !== prevSandboxId.current) {
    hasRestoredPreview.current = false;
    prevSandboxId.current = sandboxId;
  }

  const messages = data?.messages ?? [];

  /**
   * Update messages in the local SWR cache.
   * Does NOT persist to Redis - that's handled server-side.
   */
  const setMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      mutate(
        (current) => {
          const prevMessages = current?.messages ?? [];
          const newMessages =
            typeof updater === "function" ? updater(prevMessages) : updater;
          return { ...current, messages: newMessages };
        },
        { revalidate: false },
      );
    },
    [mutate],
  );

  return {
    messages,
    setMessages,
    isLoading,
  };
}
