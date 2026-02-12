"use client";

import { ExternalLinkIcon, Globe, RefreshCwIcon } from "lucide-react";
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
  const { previewUrl } = useSandboxStore();
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
      </PanelHeader>

      <div className="flex-1 min-h-0">
        {previewUrl ? (
          <WebPreview
            defaultUrl={previewUrl}
            className="h-full border-0 rounded-none"
          >
            <WebPreviewNavigation>
              <WebPreviewNavigationButton onClick={refresh} tooltip="Refresh">
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
                Loading preview...
              </p>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
