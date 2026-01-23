/**
 * Sandbox Store
 * 
 * Client-side state for sandbox, files, and command output.
 * Updated via data parts from the agent stream.
 */

import { create } from "zustand";

// ============================================================================
// Types
// ============================================================================

export interface CommandLog {
  timestamp: number;
  stream: "stdout" | "stderr";
  data: string;
}

export interface Command {
  cmdId: string;
  command: string;
  args?: string[];
  exitCode?: number;
  logs: CommandLog[];
  startedAt: number;
}

export interface SandboxState {
  // Sandbox
  sandboxId: string | null;
  previewUrl: string | null;
  status: "creating" | "ready" | "error" | null;

  // Session (for agent conversation memory)
  sessionId: string | null;

  // Files
  files: string[];

  // Commands
  commands: Command[];
}

export interface SandboxActions {
  // Sandbox
  setSandbox: (sandboxId: string, status?: SandboxState["status"]) => void;
  setPreviewUrl: (url: string) => void;
  setStatus: (status: SandboxState["status"]) => void;

  // Session
  setSessionId: (sessionId: string) => void;

  // Files
  addFile: (path: string) => void;
  addFiles: (paths: string[]) => void;

  // Commands
  addCommand: (cmd: Omit<Command, "logs" | "startedAt">) => void;
  addCommandLog: (cmdId: string, log: Omit<CommandLog, "timestamp">) => void;
  setCommandExitCode: (cmdId: string, exitCode: number) => void;

  // Reset
  reset: () => void;
}

export type SandboxStore = SandboxState & SandboxActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: SandboxState = {
  sandboxId: null,
  previewUrl: null,
  status: null,
  sessionId: null,
  files: [],
  commands: [],
};

// ============================================================================
// Store
// ============================================================================

export const useSandboxStore = create<SandboxStore>()((set) => ({
  ...initialState,

  setSandbox: (sandboxId, status = "ready") =>
    set({ sandboxId, status, files: [], commands: [], previewUrl: null }),

  setPreviewUrl: (previewUrl) => set({ previewUrl }),

  setStatus: (status) => set({ status }),

  setSessionId: (sessionId) => set({ sessionId }),

  addFile: (path) =>
    set((state) => {
      if (state.files.includes(path)) return state;
      return { files: [...state.files, path].sort() };
    }),

  addFiles: (paths) =>
    set((state) => {
      const newFiles = paths.filter((p) => !state.files.includes(p));
      if (newFiles.length === 0) return state;
      return { files: [...state.files, ...newFiles].sort() };
    }),

  addCommand: (cmd) =>
    set((state) => {
      // Don't add duplicate commands
      if (state.commands.some((c) => c.cmdId === cmd.cmdId)) return state;
      return {
        commands: [
          ...state.commands,
          { ...cmd, logs: [], startedAt: Date.now() },
        ],
      };
    }),

  addCommandLog: (cmdId, log) =>
    set((state) => {
      const idx = state.commands.findIndex((c) => c.cmdId === cmdId);
      if (idx === -1) return state;

      const commands = [...state.commands];
      commands[idx] = {
        ...commands[idx],
        logs: [...commands[idx].logs, { ...log, timestamp: Date.now() }],
      };
      return { commands };
    }),

  setCommandExitCode: (cmdId, exitCode) =>
    set((state) => {
      const idx = state.commands.findIndex((c) => c.cmdId === cmdId);
      if (idx === -1) return state;

      const commands = [...state.commands];
      commands[idx] = { ...commands[idx], exitCode };
      return { commands };
    }),

  reset: () => set(initialState),
}));

// ============================================================================
// Data Part Types (matching agent StreamChunk data parts)
// ============================================================================

export interface SandboxStatusData {
  sandboxId?: string;
  status: "creating" | "ready" | "error";
  error?: string;
}

export interface FileWrittenData {
  path: string;
}

export interface PreviewUrlData {
  url: string;
  port: number;
}

export interface CommandOutputData {
  command: string;
  output: string;
  stream: "stdout" | "stderr";
  exitCode?: number;
}

export type DataPartMap = {
  "data-sandbox-status": SandboxStatusData;
  "data-file-written": FileWrittenData;
  "data-preview-url": PreviewUrlData;
  "data-command-output": CommandOutputData;
};

// ============================================================================
// Data Part Handler
// ============================================================================

function isSandboxStatusData(data: unknown): data is SandboxStatusData {
  return (
    typeof data === "object" &&
    data !== null &&
    "status" in data &&
    typeof (data as SandboxStatusData).status === "string"
  );
}

function isFileWrittenData(data: unknown): data is FileWrittenData {
  return (
    typeof data === "object" &&
    data !== null &&
    "path" in data &&
    typeof (data as FileWrittenData).path === "string"
  );
}

function isPreviewUrlData(data: unknown): data is PreviewUrlData {
  return (
    typeof data === "object" &&
    data !== null &&
    "url" in data &&
    typeof (data as PreviewUrlData).url === "string"
  );
}

function isCommandOutputData(data: unknown): data is CommandOutputData {
  return (
    typeof data === "object" &&
    data !== null &&
    "command" in data &&
    "output" in data &&
    "stream" in data &&
    typeof (data as CommandOutputData).command === "string" &&
    typeof (data as CommandOutputData).output === "string" &&
    ((data as CommandOutputData).stream === "stdout" ||
      (data as CommandOutputData).stream === "stderr")
  );
}

/**
 * Maps incoming data parts from the agent stream to store updates.
 * Call this for each data-* part received.
 */
export function handleDataPart(
  store: SandboxStore,
  type: string,
  data: unknown
): void {
  switch (type) {
    case "data-sandbox-status": {
      if (!isSandboxStatusData(data)) return;
      if (data.sandboxId) {
        store.setSandbox(data.sandboxId, data.status);
      } else {
        store.setStatus(data.status);
      }
      break;
    }

    case "data-file-written": {
      if (!isFileWrittenData(data)) return;
      store.addFile(data.path);
      break;
    }

    case "data-preview-url": {
      if (!isPreviewUrlData(data)) return;
      store.setPreviewUrl(data.url);
      break;
    }

    case "data-command-output": {
      if (!isCommandOutputData(data)) return;
      // Use command string as ID
      const cmdId = data.command;

      // Ensure command exists
      if (!store.commands.some((c) => c.cmdId === cmdId)) {
        store.addCommand({ cmdId, command: data.command });
      }

      store.addCommandLog(cmdId, { stream: data.stream, data: data.output });

      if (data.exitCode !== undefined) {
        store.setCommandExitCode(cmdId, data.exitCode);
      }
      break;
    }

    default:
      // Unknown data part type, ignore
      break;
  }
}
