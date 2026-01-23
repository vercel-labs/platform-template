"use client";

/**
 * Workspace Panel Component
 *
 * Tabbed panel containing Files and Commands views.
 */

import { useState, useCallback, useMemo } from "react";
import { FolderTree, TerminalIcon, FileIcon } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  FileTree,
  FileTreeFolder,
  FileTreeFile,
} from "@/components/ai-elements/file-tree";
import {
  Terminal as AITerminal,
  TerminalHeader,
  TerminalTitle,
  TerminalActions,
  TerminalCopyButton,
  TerminalContent,
  TerminalStatus,
} from "@/components/ai-elements/terminal";
import { useSandboxStore } from "@/lib/store/sandbox-store";
import { cn } from "@/lib/utils";

interface WorkspacePanelProps {
  className?: string;
}

// ============================================================================
// File Tree Types and Helpers
// ============================================================================

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const fullPath of paths) {
    const displayPath = fullPath.replace(/^\/vercel\/sandbox\/?/, "");
    if (!displayPath) continue;

    const parts = displayPath.split("/").filter(Boolean);
    let currentLevel = root;
    let currentPath = "/vercel/sandbox";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = `${currentPath}/${part}`;
      const isFile = i === parts.length - 1;

      let existing = currentLevel.find((n) => n.name === part);

      if (!existing) {
        existing = {
          name: part,
          path: currentPath,
          type: isFile ? "file" : "folder",
          children: isFile ? undefined : [],
        };
        currentLevel.push(existing);
      }

      if (!isFile && existing.children) {
        currentLevel = existing.children;
      }
    }
  }

  function sortTree(nodes: TreeNode[]): TreeNode[] {
    return nodes
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "folder" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      })
      .map((node) => ({
        ...node,
        children: node.children ? sortTree(node.children) : undefined,
      }));
  }

  return sortTree(root);
}

function TreeNodes({ nodes }: { nodes: TreeNode[] }) {
  return (
    <>
      {nodes.map((node) =>
        node.type === "folder" ? (
          <FileTreeFolder key={node.path} path={node.path} name={node.name}>
            {node.children && <TreeNodes nodes={node.children} />}
          </FileTreeFolder>
        ) : (
          <FileTreeFile key={node.path} path={node.path} name={node.name} />
        )
      )}
    </>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function WorkspacePanel({ className }: WorkspacePanelProps) {
  const { files, commands, sandboxId } = useSandboxStore();
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // File tree
  const tree = useMemo(() => buildTree(files), [files]);
  const defaultExpanded = useMemo(() => {
    const expanded = new Set<string>();
    tree.forEach((node) => {
      if (node.type === "folder") {
        expanded.add(node.path);
      }
    });
    return expanded;
  }, [tree]);

  // Terminal output
  const isStreaming = commands.some((cmd) => cmd.exitCode === undefined);
  const terminalOutput = useMemo(() => {
    return commands
      .map((cmd) => {
        const header = `$ ${cmd.command}${cmd.args?.length ? ` ${cmd.args.join(" ")}` : ""}\n`;
        const logs = cmd.logs.map((log) => log.data).join("");
        const footer =
          cmd.exitCode !== undefined ? `\nExit code: ${cmd.exitCode}\n` : "";
        return header + logs + footer;
      })
      .join("\n");
  }, [commands]);

  // File loading
  const loadFileAsync = useCallback(
    async (path: string) => {
      if (!sandboxId) return;

      setSelectedPath(path);
      setLoading(true);
      setFileContent(null);

      try {
        const { rpc } = await import("@/lib/rpc/client");
        const result = await rpc.sandbox.readFile({ sandboxId, path });
        setFileContent(result.content);
      } catch (err) {
        setFileContent(`Error loading file: ${err}`);
      } finally {
        setLoading(false);
      }
    },
    [sandboxId]
  );

  const loadFile = useCallback(
    (path: string) => {
      void loadFileAsync(path);
    },
    [loadFileAsync]
  );

  return (
    <Panel className={cn("flex flex-col", className)}>
      <Tabs defaultValue="files" className="flex-1 flex flex-col min-h-0">
        <PanelHeader className="pb-0">
          <TabsList>
            <TabsTrigger value="files" className="gap-1.5">
              <FolderTree className="h-3.5 w-3.5" />
              Files
              <span className="text-xs text-muted-foreground">
                ({files.length})
              </span>
            </TabsTrigger>
            <TabsTrigger value="commands" className="gap-1.5">
              <TerminalIcon className="h-3.5 w-3.5" />
              Commands
              <span className="text-xs text-muted-foreground">
                ({commands.length})
              </span>
            </TabsTrigger>
          </TabsList>
        </PanelHeader>

        {/* Files Tab */}
        <TabsContent value="files" className="flex-1 min-h-0 flex">
          <div className="flex flex-1 min-h-0">
            {/* File Tree */}
            <div className="w-1/2 overflow-auto border-r border-zinc-200 dark:border-zinc-800">
              {files.length === 0 ? (
                <p className="p-4 font-mono text-xs text-zinc-500">
                  No files yet.
                </p>
              ) : (
                <FileTree
                  defaultExpanded={defaultExpanded}
                  selectedPath={selectedPath}
                  // @ts-expect-error - ai-elements FileTree onSelect type conflicts with HTMLAttributes
                  onSelect={loadFile}
                  className="border-0 rounded-none bg-transparent"
                >
                  <TreeNodes nodes={tree} />
                </FileTree>
              )}
            </div>

            {/* File Content */}
            <div className="w-1/2 overflow-auto p-2">
              {loading ? (
                <p className="font-mono text-xs text-zinc-500">Loading...</p>
              ) : selectedPath ? (
                <div>
                  <p className="mb-2 font-mono text-xs text-zinc-500 truncate">
                    {selectedPath.replace(/^\/vercel\/sandbox\/?/, "")}
                  </p>
                  <pre className="overflow-auto rounded bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-900">
                    {fileContent}
                  </pre>
                </div>
              ) : (
                <p className="font-mono text-xs text-zinc-500">
                  Select a file to view
                </p>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Commands Tab */}
        <TabsContent value="commands" className="flex-1 min-h-0">
          <AITerminal
            output={terminalOutput}
            isStreaming={isStreaming}
            autoScroll={true}
            className="h-full border-0 rounded-none"
          >
            <TerminalHeader>
              <TerminalTitle />
              <div className="flex items-center gap-1">
                <TerminalStatus />
                <TerminalActions>
                  <TerminalCopyButton />
                </TerminalActions>
              </div>
            </TerminalHeader>
            <TerminalContent className="flex-1 max-h-none" />
          </AITerminal>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
