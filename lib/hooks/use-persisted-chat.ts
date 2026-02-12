"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import useSWR from "swr";
import { rpc } from "@/lib/rpc/client";
import { useSandboxStore } from "@/lib/store/sandbox-store";
import type { ChatMessage } from "@/lib/chat-history";

export type { ChatMessage, MessagePart } from "@/lib/chat-history";

interface SessionData {
  messages: ChatMessage[];
  previewUrl?: string;
  projectId?: string;
  projectOwnership?: "partner" | "user";
  deploymentUrl?: string;
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
 * The setMessages function updates local state for optimistic UI updates.
 * When a sandboxId exists, it also syncs with SWR cache.
 */
export function usePersistedChat() {
  const sandboxId = useSandboxStore((s) => s.sandboxId);
  const setPreviewUrl = useSandboxStore((s) => s.setPreviewUrl);
  const setProject = useSandboxStore((s) => s.setProject);

  // Local state for messages (used when no sandboxId or during streaming)
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);

  // Fetch session from Redis when sandboxId exists
  const { data, isLoading, mutate } = useSWR(
    sandboxId ? ["sandbox-session", sandboxId] : null,
    ([, id]) => fetchSession(id),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );

  // Restore previewUrl and deployment state when session loads
  const hasRestoredSession = useRef(false);
  useEffect(() => {
    if (data && !hasRestoredSession.current) {
      if (data.previewUrl) {
        setPreviewUrl(data.previewUrl);
      }
      if (data.projectId) {
        setProject(
          data.projectId,
          data.projectOwnership ?? "partner",
          data.deploymentUrl,
        );
      }
      hasRestoredSession.current = true;
    }
  }, [data, setPreviewUrl, setProject]);

  // When sandboxId changes, reset local state and restore flag
  const prevSandboxId = useRef(sandboxId);
  useEffect(() => {
    if (sandboxId !== prevSandboxId.current) {
      hasRestoredSession.current = false;
      prevSandboxId.current = sandboxId;
      // Reset local messages when sandbox changes (will be replaced by SWR data)
      if (sandboxId && data?.messages) {
        setLocalMessages(data.messages);
      }
    }
  }, [sandboxId, data?.messages]);

  // Sync local messages with SWR data when it loads
  useEffect(() => {
    if (data?.messages && data.messages.length > 0) {
      setLocalMessages(data.messages);
    }
  }, [data?.messages]);

  // Use local messages as source of truth (includes optimistic updates)
  const messages = localMessages;

  /**
   * Update messages in local state.
   * Also syncs to SWR cache if sandboxId exists.
   */
  const setMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      setLocalMessages((prev) => {
        const newMessages =
          typeof updater === "function" ? updater(prev) : updater;
        return newMessages;
      });

      // Also update SWR cache if we have a sandboxId
      if (sandboxId) {
        mutate(
          (current) => {
            const prevMessages = current?.messages ?? localMessages;
            const newMessages =
              typeof updater === "function" ? updater(prevMessages) : updater;
            return { ...current, messages: newMessages };
          },
          { revalidate: false },
        );
      }
    },
    [sandboxId, mutate, localMessages],
  );

  return {
    messages,
    setMessages,
    isLoading,
  };
}
