"use client";

/**
 * Chat Context
 *
 * Provides a shared Chat instance and handles data part updates to the sandbox store.
 */

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Chat } from "@ai-sdk/react";
import type { ChatMessage, ChatDataPart } from "@/lib/types";
import { useSandboxStore, handleDataPart } from "@/lib/store/sandbox-store";

// ============================================================================
// Context
// ============================================================================

interface ChatContextValue {
  chat: Chat<ChatMessage>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function ChatProvider({ children }: { children: ReactNode }) {
  const store = useSandboxStore();
  // Use a ref to avoid stale closures
  const storeRef = useRef(store);
  storeRef.current = store;

  const chat = useMemo(
    () =>
      new Chat<ChatMessage>({
        onData: (data: ChatDataPart) => {
          // Route data parts to the sandbox store
          handleDataPart(storeRef.current, data.type, data.data);
        },
        onError: (error) => {
          console.error("Chat error:", error);
        },
      }),
    []
  );

  return (
    <ChatContext.Provider value={{ chat }}>{children}</ChatContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useSharedChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useSharedChat must be used within a ChatProvider");
  }
  return context;
}
