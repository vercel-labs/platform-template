"use client";

import { useState } from "react";
import { MessageCircle, Monitor } from "lucide-react";
import { Chat } from "@/components/chat/chat";
import { Preview } from "@/components/preview";
import { WorkspacePanel } from "@/components/workspace-panel";
import { cn } from "@/lib/utils";
import { useSandboxFromUrl } from "@/lib/hooks/use-sandbox-from-url";

type MobileTab = "chat" | "preview";

export function MainLayout() {
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");

  // Restore sandboxId from URL if present (e.g., after redirect)
  useSandboxFromUrl();

  return (
    <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
      {/* Mobile Tab Switcher */}
      <div className="flex shrink-0 border-b border-zinc-200 lg:hidden dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setMobileTab("chat")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
            mobileTab === "chat"
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300",
          )}
        >
          <MessageCircle className="h-4 w-4" />
          Chat
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("preview")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
            mobileTab === "preview"
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300",
          )}
        >
          <Monitor className="h-4 w-4" />
          Preview
        </button>
      </div>

      {/* Chat Panel - single instance, shown/hidden via CSS */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-hidden",
          // Mobile: show/hide based on tab
          mobileTab !== "chat" && "max-lg:hidden",
          // Desktop: fixed width sidebar
          "lg:w-[44rem] lg:flex-none lg:border-r lg:border-zinc-200 lg:dark:border-zinc-800",
        )}
      >
        <Chat className="h-full rounded-none border-0" />
      </div>

      {/* Preview + Workspace Panel - single instance, shown/hidden via CSS */}
      <div
        className={cn(
          "min-h-0 flex-1 flex-col overflow-hidden",
          // Mobile: show/hide based on tab
          mobileTab === "preview" ? "flex max-lg:flex" : "max-lg:hidden",
          // Desktop: always visible
          "lg:flex",
        )}
      >
        <div className="min-h-0 flex-1 border-b border-zinc-200 dark:border-zinc-800">
          <Preview className="h-full rounded-none border-0" />
        </div>
        <div className="h-48 shrink-0 lg:h-56">
          <WorkspacePanel className="h-full rounded-none border-0" />
        </div>
      </div>
    </div>
  );
}
