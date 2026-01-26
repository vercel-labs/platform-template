"use client";

/**
 * Preview Component
 *
 * Displays the sandbox preview using ai-elements WebPreview.
 */

import {
  ExternalLinkIcon,
  Globe,
  RefreshCwIcon,
} from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import {
  WebPreview,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
  WebPreviewBody,
} from "@/components/ai-elements/web-preview";
import { useSandboxStore } from "@/lib/store/sandbox-store";
import { cn } from "@/lib/utils";
import { useState, useCallback } from "react";

interface PreviewProps {
  className?: string;
}

export function Preview({ className }: PreviewProps) {
  const { previewUrl, sandboxId, status } = useSandboxStore();
  const [key, setKey] = useState(0);
  
  // Debug log
  console.log("[preview] Current state:", { previewUrl, sandboxId, status });

  const refresh = useCallback(() => {
    setKey((k) => k + 1);
  }, []);

  const openExternal = useCallback(() => {
    if (previewUrl) {
      window.open(previewUrl, "_blank");
    }
  }, [previewUrl]);

  return (
    <Panel className={cn("flex flex-col", className)}>
      <PanelHeader>
        <div className="flex items-center gap-2 font-mono text-sm font-semibold uppercase">
          <Globe className="h-4 w-4" />
          Preview
        </div>
        <span className="font-mono text-xs text-zinc-500">
          {status === "creating"
            ? "[creating...]"
            : sandboxId
              ? `[${sandboxId.slice(0, 8)}...]`
              : "[no sandbox]"}
        </span>
      </PanelHeader>

      <div className="flex-1 min-h-0">
        {previewUrl ? (
          <WebPreview
            defaultUrl={previewUrl}
            className="h-full border-0 rounded-none"
          >
            <WebPreviewNavigation>
              <WebPreviewNavigationButton
                onClick={refresh}
                tooltip="Refresh"
              >
                <RefreshCwIcon className="h-4 w-4" />
              </WebPreviewNavigationButton>
              <WebPreviewUrl readOnly className="font-mono text-xs" />
              <WebPreviewNavigationButton
                onClick={openExternal}
                tooltip="Open in new tab"
              >
                <ExternalLinkIcon className="h-4 w-4" />
              </WebPreviewNavigationButton>
            </WebPreviewNavigation>
            <WebPreviewBody key={key} />
          </WebPreview>
        ) : (
          <div className="flex h-full items-center justify-center bg-zinc-100 dark:bg-zinc-900">
            <div className="text-center">
              <Globe className="mx-auto mb-2 h-8 w-8 text-zinc-400" />
              <p className="font-mono text-sm text-zinc-500">
                {status === "creating"
                  ? "Creating sandbox..."
                  : sandboxId
                    ? "Start a dev server to see preview"
                    : "No sandbox active"}
              </p>
              {sandboxId && (
                <p className="mt-2 font-mono text-xs text-zinc-400">
                  Ask the agent to run &quot;npm run dev&quot;
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
