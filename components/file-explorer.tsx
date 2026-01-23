"use client";

/**
 * File Explorer Component
 *
 * Displays the file tree from the sandbox and allows viewing file content.
 */

import { useState, useCallback } from "react";
import { FolderTree, FileIcon, FolderIcon, ChevronRight } from "lucide-react";
import { Panel, PanelHeader, PanelContent } from "@/components/ui/panel";
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

export function FileExplorer({ className }: FileExplorerProps) {
  const { files, sandboxId } = useSandboxStore();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set()
  );

  const tree = buildTree(files);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const loadFile = useCallback(
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
        <div className="w-1/2 overflow-auto border-r border-zinc-200 p-2 dark:border-zinc-800">
          {files.length === 0 ? (
            <p className="p-2 font-mono text-xs text-zinc-500">
              No files yet. Start a conversation to generate code.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {tree.map((node) => (
                <TreeItem
                  key={node.path}
                  node={node}
                  selectedPath={selectedPath}
                  expandedFolders={expandedFolders}
                  onSelect={loadFile}
                  onToggle={toggleFolder}
                />
              ))}
            </ul>
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

interface TreeItemProps {
  node: TreeNode;
  selectedPath: string | null;
  expandedFolders: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  depth?: number;
}

function TreeItem({
  node,
  selectedPath,
  expandedFolders,
  onSelect,
  onToggle,
  depth = 0,
}: TreeItemProps) {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedPath === node.path;

  if (node.type === "folder") {
    return (
      <li>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-1 rounded px-2 py-1 font-mono text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800",
            isSelected && "bg-zinc-100 dark:bg-zinc-800"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => onToggle(node.path)}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform",
              isExpanded && "rotate-90"
            )}
          />
          <FolderIcon className="h-3 w-3 text-blue-500" />
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded && node.children && (
          <ul>
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                expandedFolders={expandedFolders}
                onSelect={onSelect}
                onToggle={onToggle}
                depth={depth + 1}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-1 rounded px-2 py-1 font-mono text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800",
          isSelected && "bg-zinc-200 dark:bg-zinc-700"
        )}
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
        onClick={() => onSelect(node.path)}
      >
        <FileIcon className="h-3 w-3 text-zinc-400" />
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  );
}
