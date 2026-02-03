import { create } from "zustand";
import {
  UI_DATA_PART_TYPES,
  parseDataPart,
  DATA_PART_TYPES,
  type SandboxStatusData,
  type FileWrittenData,
  type PreviewUrlData,
  type CommandOutputData,
  type SandboxStatus,
  type StreamType,
} from "@/lib/types";

export interface CommandLog {
  timestamp: number;
  stream: StreamType;
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
  sandboxId: string | null;
  previewUrl: string | null;
  status: SandboxStatus | null;
  statusMessage: string | null;

  sessionId: string | null;

  agentId: string;

  files: string[];

  commands: Command[];
}

export interface SandboxActions {
  setSandbox: (sandboxId: string, status?: SandboxState["status"]) => void;
  setPreviewUrl: (url: string) => void;
  setStatus: (status: SandboxState["status"], message?: string) => void;

  setSessionId: (sessionId: string) => void;

  setAgentId: (agentId: string) => void;

  addFile: (path: string) => void;
  addFiles: (paths: string[]) => void;

  addCommand: (cmd: Omit<Command, "logs" | "startedAt">) => void;
  addCommandLog: (cmdId: string, log: Omit<CommandLog, "timestamp">) => void;
  setCommandExitCode: (cmdId: string, exitCode: number) => void;

  reset: () => void;
}

export type SandboxStore = SandboxState & SandboxActions;

const initialState: SandboxState = {
  sandboxId: null,
  previewUrl: null,
  status: null,
  statusMessage: null,
  sessionId: null,
  agentId: "claude",
  files: [],
  commands: [],
};

export const useSandboxStore = create<SandboxStore>()((set, get) => ({
  ...initialState,

  setSandbox: (sandboxId, status = "ready") =>
    set((state) => {
      if (state.sandboxId === sandboxId) {
        return { sandboxId, status };
      }
      return { sandboxId, status, files: [], commands: [], previewUrl: null };
    }),

  setPreviewUrl: (previewUrl) => set({ previewUrl }),

  setStatus: (status, message) =>
    set({ status, statusMessage: message ?? null }),

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

export function handleDataPart(
  store: SandboxStore,
  type: string,
  data: unknown,
): void {
  switch (type) {
    case UI_DATA_PART_TYPES.SANDBOX_STATUS: {
      const parsed = parseDataPart(DATA_PART_TYPES.SANDBOX_STATUS, data);
      if (!parsed) return;
      const sandboxData = parsed as SandboxStatusData;
      if (sandboxData.sandboxId) {
        store.setSandbox(sandboxData.sandboxId, sandboxData.status);
      }
      store.setStatus(sandboxData.status, sandboxData.message);
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
      const cmdId = cmdData.command;

      if (!store.commands.some((c) => c.cmdId === cmdId)) {
        store.addCommand({ cmdId, command: cmdData.command });
      }

      store.addCommandLog(cmdId, {
        stream: cmdData.stream,
        data: cmdData.output,
      });

      if (cmdData.exitCode !== undefined) {
        store.setCommandExitCode(cmdId, cmdData.exitCode);
      }
      break;
    }

    default:
      break;
  }
}
