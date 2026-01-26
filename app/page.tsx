import { Chat } from "@/components/chat/chat";
import { Preview } from "@/components/preview";
import { WorkspacePanel } from "@/components/workspace-panel";

export default function Page() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h1 className="font-mono text-sm font-semibold">Platform Template</h1>
        <span className="font-mono text-xs text-zinc-500">
          AI Code Generation
        </span>
      </header>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chat Sidebar */}
        <div className="w-[48rem] shrink-0 border-r border-zinc-200 dark:border-zinc-800">
          <Chat className="h-full rounded-none border-0" />
        </div>

        {/* Right: Preview + Workspace */}
        <div className="flex flex-1 flex-col">
          {/* Preview - fills remaining space */}
          <div className="flex-1 border-b border-zinc-200 dark:border-zinc-800">
            <Preview className="h-full rounded-none border-0" />
          </div>

          {/* Files/Commands Tabs - fixed height */}
          <div className="h-64">
            <WorkspacePanel className="h-full rounded-none border-0" />
          </div>
        </div>
      </div>
    </div>
  );
}
