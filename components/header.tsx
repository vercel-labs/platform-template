"use client";

import { AuthButton } from "@/components/auth";
import { DeployPopover } from "@/components/deploy-popover";
import { useSandboxStore } from "@/lib/store/sandbox-store";

export function Header() {
  const { sandboxId } = useSandboxStore();

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
      <h1 className="font-mono text-sm font-semibold">Platform Template</h1>
      <div className="flex items-center gap-3">
        {/* Deploy button is always shown - signed-out users deploy to partner team */}
        <DeployPopover sandboxId={sandboxId} disabled={!sandboxId} />
        <AuthButton />
      </div>
    </header>
  );
}
