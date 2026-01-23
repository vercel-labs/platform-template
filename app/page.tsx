import { Chat } from "@/components/chat/chat";
import { FileExplorer } from "@/components/file-explorer";
import { Terminal } from "@/components/terminal";
import { Preview } from "@/components/preview";

export default function Page() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 p-2 dark:bg-zinc-900">
      {/* Header */}
      <header className="mb-2 flex items-center justify-between px-2">
        <h1 className="font-mono text-sm font-semibold">
          Platform Template
        </h1>
        <span className="font-mono text-xs text-zinc-500">
          AI Code Generation & Deployment
        </span>
      </header>

      {/* Main Layout */}
      <div className="flex flex-1 gap-2 overflow-hidden">
        {/* Left: Chat */}
        <div className="w-1/2">
          <Chat className="h-full" />
        </div>

        {/* Right: Preview, Files, Terminal */}
        <div className="flex w-1/2 flex-col gap-2">
          <Preview className="h-1/3" />
          <FileExplorer className="h-1/3" />
          <Terminal className="h-1/3" />
        </div>
      </div>
    </div>
  );
}
