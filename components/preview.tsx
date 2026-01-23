"use client";

/**
 * Preview Component
 *
 * Displays the sandbox preview in an iframe.
 */

import { ExternalLink, Globe, RefreshCw } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { useSandboxStore } from "@/lib/store/sandbox-store";
import { cn } from "@/lib/utils";
import { useState, useCallback } from "react";

interface PreviewProps {
  className?: string;
}

export function Preview({ className }: PreviewProps) {
  const { previewUrl, sandboxId, status } = useSandboxStore();
  const [key, setKey] = useState(0);

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
        <div className="flex items-center gap-2">
          {previewUrl && (
            <>
              <button
                type="button"
                onClick={refresh}
                className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="Refresh"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={openExternal}
                className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="Open in new tab"
              >
                <ExternalLink className="h-3 w-3" />
              </button>
            </>
          )}
          <span className="font-mono text-xs text-zinc-500">
            {status === "creating"
              ? "[creating...]"
              : sandboxId
                ? `[${sandboxId.slice(0, 8)}...]`
                : "[no sandbox]"}
          </span>
        </div>
      </PanelHeader>

      <div className="flex-1 bg-zinc-100 dark:bg-zinc-900">
        {previewUrl ? (
          <iframe
            key={key}
            src={previewUrl}
            className="h-full w-full border-0"
            title="Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
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
