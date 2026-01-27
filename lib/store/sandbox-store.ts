/**
 * Sandbox Store
 *
 * Client-side state for sandbox, files, and command output.
 * Updated via data parts from the agent stream.
 */

import { create } from "zustand";
import {
  UI_DATA_PART_TYPES,
  parseDataPart,
  DATA_PART_TYPES,
  type SandboxStatusData,
  type FileWrittenData,
  type PreviewUrlData,
  type CommandOutputData,
} from "@/lib/types";

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
  status: "creating" | "warming" | "ready" | "error" | null;

  // Session (for agent conversation memory)
  sessionId: string | null;

  // Agent selection
  agentId: string;

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

  // Agent
  setAgentId: (agentId: string) => void;

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
  agentId: "claude", // Default agent
  files: [],
  commands: [],
};

// ============================================================================
// Store
// ============================================================================

export const useSandboxStore = create<SandboxStore>()((set, get) => ({
  ...initialState,

  setSandbox: (sandboxId, status = "ready") =>
    set((state) => {
      // Only reset files/commands/preview if it's a different sandbox
      if (state.sandboxId === sandboxId) {
        return { sandboxId, status };
      }
      return { sandboxId, status, files: [], commands: [], previewUrl: null };
    }),

  setPreviewUrl: (previewUrl) => set({ previewUrl }),

  setStatus: (status) => set({ status }),

  setSessionId: (sessionId) => set({ sessionId }),

  setAgentId: (agentId) => set({ agentId }),

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
// Data Part Handler
// ============================================================================

/**
 * Maps incoming data parts from the agent stream to store updates.
 * Call this for each data-* part received.
 *
 * Uses zod schemas for runtime validation of incoming data.
 */
export function handleDataPart(
  store: SandboxStore,
  type: string,
  data: unknown
): void {
  switch (type) {
    case UI_DATA_PART_TYPES.SANDBOX_STATUS: {
      const parsed = parseDataPart(DATA_PART_TYPES.SANDBOX_STATUS, data);
      if (!parsed) return;
      const sandboxData = parsed as SandboxStatusData;
      if (sandboxData.sandboxId) {
        store.setSandbox(sandboxData.sandboxId, sandboxData.status);
      } else {
        store.setStatus(sandboxData.status);
      }
      break;
    }

    case UI_DATA_PART_TYPES.FILE_WRITTEN: {
      const parsed = parseDataPart(DATA_PART_TYPES.FILE_WRITTEN, data);
      if (!parsed) return;
      const fileData = parsed as FileWrittenData;
      store.addFile(fileData.path);
      break;
    }

    case UI_DATA_PART_TYPES.PREVIEW_URL: {
      const parsed = parseDataPart(DATA_PART_TYPES.PREVIEW_URL, data);
      if (!parsed) return;
      const previewData = parsed as PreviewUrlData;
      store.setPreviewUrl(previewData.url);
      break;
    }

    case UI_DATA_PART_TYPES.COMMAND_OUTPUT: {
      const parsed = parseDataPart(DATA_PART_TYPES.COMMAND_OUTPUT, data);
      if (!parsed) return;
      const cmdData = parsed as CommandOutputData;
      // Use command string as ID
      const cmdId = cmdData.command;

      // Ensure command exists
      if (!store.commands.some((c) => c.cmdId === cmdId)) {
        store.addCommand({ cmdId, command: cmdData.command });
      }

      store.addCommandLog(cmdId, { stream: cmdData.stream, data: cmdData.output });

      if (cmdData.exitCode !== undefined) {
        store.setCommandExitCode(cmdId, cmdData.exitCode);
      }
      break;
    }

    default:
      // Unknown data part type, ignore
      break;
  }
}
