"use client";

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

interface ChatContextValue {
  chat: Chat<ChatMessage>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const store = useSandboxStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  const chat = useMemo(
    () =>
      new Chat<ChatMessage>({
        onData: (data: ChatDataPart) => {
          handleDataPart(storeRef.current, data.type, data.data);
        },
        onError: (error) => {
          console.error("Chat error:", error);
        },
      }),
    [],
  );

  return (
    <ChatContext.Provider value={{ chat }}>{children}</ChatContext.Provider>
  );
}

export function useSharedChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useSharedChat must be used within a ChatProvider");
  }
  return context;
}
