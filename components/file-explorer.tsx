"use client";

/**
 * File Explorer Component
 *
 * Displays the file tree from the sandbox using ai-elements FileTree.
 */

import { useState, useCallback, useMemo } from "react";
import { FolderTree } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import {
  FileTree,
  FileTreeFolder,
  FileTreeFile,
} from "@/components/ai-elements/file-tree";
import { useSandboxStore } from "@/lib/store/sandbox-store";
import { cn } from "@/lib/utils";

interface FileExplorerProps {
  className?: string;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const fullPath of paths) {
    // Remove /vercel/sandbox prefix for display
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

  // Sort: folders first, then files, alphabetically
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

// Recursively render tree nodes
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

export function FileExplorer({ className }: FileExplorerProps) {
  const { files, sandboxId } = useSandboxStore();
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const tree = useMemo(() => buildTree(files), [files]);

  // Default expand the root folders
  const defaultExpanded = useMemo(() => {
    const expanded = new Set<string>();
    // Expand first level folders
    tree.forEach((node) => {
      if (node.type === "folder") {
        expanded.add(node.path);
      }
    });
    return expanded;
  }, [tree]);

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

  // Wrapper to satisfy FileTree's synchronous onSelect type
  const loadFile = useCallback(
    (path: string) => {
      void loadFileAsync(path);
    },
    [loadFileAsync]
  );

  return (
    <Panel className={cn("flex flex-col", className)}>
      <PanelHeader>
        <div className="flex items-center gap-2 font-mono text-sm font-semibold uppercase">
          <FolderTree className="h-4 w-4" />
          Files
        </div>
        <div className="font-mono text-xs text-zinc-500">
          {files.length} files
        </div>
      </PanelHeader>

      <div className="flex flex-1 min-h-0">
        {/* File Tree */}
        <div className="w-1/2 overflow-auto border-r border-zinc-200 dark:border-zinc-800">
          {files.length === 0 ? (
            <p className="p-4 font-mono text-xs text-zinc-500">
              No files yet. Start a conversation to generate code.
            </p>
          ) : (
            <FileTree
              defaultExpanded={defaultExpanded}
              selectedPath={selectedPath}
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
              Select a file to view its content
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}
