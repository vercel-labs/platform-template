"use client";

import { type ReactNode, createContext, useContext, useState } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
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
import type { TemplateId } from "@/lib/templates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/**
 * Project ownership indicates who currently owns the deployed project:
 * - 'partner': Project is on the partner team (not yet claimed)
 * - 'user': Project has been claimed by a user
 * - null: No project deployed yet
 */
export type ProjectOwnership = "partner" | "user" | null;

export interface SandboxState {
  chatId: string | null;
  sandboxId: string | null;
  previewUrl: string | null;
  isBuildingApp: boolean;
  status: SandboxStatus | null;
  statusMessage: string | null;

  sessionId: string | null;

  agentId: string;
  templateId: TemplateId;

  files: string[];

  commands: Command[];

  // Deployment state
  projectId: string | null;
  projectOwnership: ProjectOwnership;
  deploymentUrl: string | null;
}

export interface SandboxActions {
  setSandbox: (sandboxId: string, status?: SandboxState["status"]) => void;
  setPreviewUrl: (url: string | null) => void;
  setIsBuildingApp: (value: boolean) => void;
  setStatus: (status: SandboxState["status"], message?: string) => void;

  setSessionId: (sessionId: string) => void;

  setAgentId: (agentId: string) => void;
  setTemplateId: (templateId: TemplateId) => void;

  addFile: (path: string) => void;
  addFiles: (paths: string[]) => void;

  addCommand: (cmd: Omit<Command, "logs" | "startedAt">) => void;
  addCommandLog: (cmdId: string, log: Omit<CommandLog, "timestamp">) => void;
  setCommandExitCode: (cmdId: string, exitCode: number) => void;

  setProject: (
    projectId: string,
    ownership: ProjectOwnership,
    deploymentUrl?: string,
  ) => void;
  setProjectOwnership: (ownership: ProjectOwnership) => void;

  /** Process a data part received from the AI chat stream. */
  applyStreamData: (type: string, data: unknown) => void;

  reset: () => void;
}

export type SandboxStore = SandboxState & SandboxActions;

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export const defaultInitState: SandboxState = {
  chatId: null,
  sandboxId: null,
  previewUrl: null,
  isBuildingApp: false,
  status: null,
  statusMessage: null,
  sessionId: null,
  agentId: "claude",
  templateId: "nextjs",
  files: [],
  commands: [],
  projectId: null,
  projectOwnership: null,
  deploymentUrl: null,
};

export const createSandboxStore = (
  initState: Partial<SandboxState> = {},
) => {
  const state = { ...defaultInitState, ...initState };
  return createStore<SandboxStore>()((set, get) => ({
    ...state,

    setSandbox: (sandboxId, status = "ready") =>
      set((prev) => {
        if (prev.sandboxId === sandboxId) {
          return { sandboxId, status };
        }
        return {
          sandboxId,
          status,
          files: [],
          commands: [],
          previewUrl: null,
          projectId: null,
          projectOwnership: null,
          deploymentUrl: null,
        };
      }),

    setPreviewUrl: (previewUrl) => set({ previewUrl }),
    setIsBuildingApp: (isBuildingApp) => set({ isBuildingApp }),
    setStatus: (status, message) =>
      set({ status, statusMessage: message ?? null }),
    setSessionId: (sessionId) => set({ sessionId }),
    setAgentId: (agentId) => set({ agentId }),
    setTemplateId: (templateId) => set({ templateId }),

    addFile: (path) =>
      set((prev) => {
        if (prev.files.includes(path)) return prev;
        return { files: [...prev.files, path].sort() };
      }),

    addFiles: (paths) =>
      set((prev) => {
        const newFiles = paths.filter((p) => !prev.files.includes(p));
        if (newFiles.length === 0) return prev;
        return { files: [...prev.files, ...newFiles].sort() };
      }),

    addCommand: (cmd) =>
      set((prev) => {
        if (prev.commands.some((c) => c.cmdId === cmd.cmdId)) return prev;
        return {
          commands: [
            ...prev.commands,
            { ...cmd, logs: [], startedAt: Date.now() },
          ],
        };
      }),

    addCommandLog: (cmdId, log) =>
      set((prev) => {
        const idx = prev.commands.findIndex((c) => c.cmdId === cmdId);
        if (idx === -1) return prev;
        const commands = [...prev.commands];
        commands[idx] = {
          ...commands[idx],
          logs: [...commands[idx].logs, { ...log, timestamp: Date.now() }],
        };
        return { commands };
      }),

    setCommandExitCode: (cmdId, exitCode) =>
      set((prev) => {
        const idx = prev.commands.findIndex((c) => c.cmdId === cmdId);
        if (idx === -1) return prev;
        const commands = [...prev.commands];
        commands[idx] = { ...commands[idx], exitCode };
        return { commands };
      }),

    setProject: (projectId, ownership, deploymentUrl) =>
      set({
        projectId,
        projectOwnership: ownership,
        deploymentUrl: deploymentUrl ?? null,
      }),

    setProjectOwnership: (ownership) => set({ projectOwnership: ownership }),

    applyStreamData: (type, data) => {
      const self = get();
      switch (type) {
        case UI_DATA_PART_TYPES.SANDBOX_STATUS: {
          const parsed = parseDataPart(DATA_PART_TYPES.SANDBOX_STATUS, data);
          if (!parsed) return;
          const d = parsed as SandboxStatusData;
          if (d.sandboxId) self.setSandbox(d.sandboxId, d.status);
          self.setStatus(d.status, d.message);
          break;
        }
        case UI_DATA_PART_TYPES.FILE_WRITTEN: {
          const parsed = parseDataPart(DATA_PART_TYPES.FILE_WRITTEN, data);
          if (!parsed) return;
          self.addFile((parsed as FileWrittenData).path);
          break;
        }
        case UI_DATA_PART_TYPES.PREVIEW_URL: {
          const parsed = parseDataPart(DATA_PART_TYPES.PREVIEW_URL, data);
          if (!parsed) return;
          self.setPreviewUrl((parsed as PreviewUrlData).url);
          break;
        }
        case UI_DATA_PART_TYPES.COMMAND_OUTPUT: {
          const parsed = parseDataPart(DATA_PART_TYPES.COMMAND_OUTPUT, data);
          if (!parsed) return;
          const d = parsed as CommandOutputData;
          const cmdId = d.command;
          self.addCommand({ cmdId, command: d.command });
          self.addCommandLog(cmdId, { stream: d.stream, data: d.output });
          if (d.exitCode !== undefined) self.setCommandExitCode(cmdId, d.exitCode);
          break;
        }
        default:
          break;
      }
    },

    reset: () => set(state),
  }));
};

export type SandboxStoreApi = ReturnType<typeof createSandboxStore>;

// ---------------------------------------------------------------------------
// Context & Provider
// ---------------------------------------------------------------------------

const SandboxStoreContext = createContext<SandboxStoreApi | undefined>(
  undefined,
);

export function SandboxStoreProvider({
  children,
  ...initState
}: Partial<SandboxState> & { children: ReactNode }) {
  const [store] = useState(() => createSandboxStore(initState));
  return (
    <SandboxStoreContext.Provider value={store}>
      {children}
    </SandboxStoreContext.Provider>
  );
}

function useStoreContext() {
  const context = useContext(SandboxStoreContext);
  if (!context) {
    throw new Error("Sandbox hooks must be used within SandboxStoreProvider");
  }
  return context;
}

// ---------------------------------------------------------------------------
// State hooks
// ---------------------------------------------------------------------------

export const useChatId = () => useStore(useStoreContext(), (s) => s.chatId);
export const useSandboxId = () => useStore(useStoreContext(), (s) => s.sandboxId);
export const usePreviewUrl = () => useStore(useStoreContext(), (s) => s.previewUrl);
export const useIsBuildingApp = () => useStore(useStoreContext(), (s) => s.isBuildingApp);
export const useSandboxStatus = () => useStore(useStoreContext(), (s) => s.status);
export const useStatusMessage = () => useStore(useStoreContext(), (s) => s.statusMessage);
export const useSessionId = () => useStore(useStoreContext(), (s) => s.sessionId);
export const useAgentId = () => useStore(useStoreContext(), (s) => s.agentId);
export const useTemplateId = () => useStore(useStoreContext(), (s) => s.templateId);
export const useFiles = () => useStore(useStoreContext(), (s) => s.files);
export const useCommands = () => useStore(useStoreContext(), (s) => s.commands);
export const useProjectId = () => useStore(useStoreContext(), (s) => s.projectId);
export const useProjectOwnership = () => useStore(useStoreContext(), (s) => s.projectOwnership);
export const useDeploymentUrl = () => useStore(useStoreContext(), (s) => s.deploymentUrl);

// ---------------------------------------------------------------------------
// Derived state hooks
// ---------------------------------------------------------------------------

export const useShowPreview = () =>
  useStore(useStoreContext(), (s) => !!s.previewUrl || s.isBuildingApp);

// ---------------------------------------------------------------------------
// Action hooks
// ---------------------------------------------------------------------------

export const useSetSandbox = () => useStore(useStoreContext(), (s) => s.setSandbox);
export const useSetPreviewUrl = () => useStore(useStoreContext(), (s) => s.setPreviewUrl);
export const useSetIsBuildingApp = () => useStore(useStoreContext(), (s) => s.setIsBuildingApp);
export const useSetStatus = () => useStore(useStoreContext(), (s) => s.setStatus);
export const useSetSessionId = () => useStore(useStoreContext(), (s) => s.setSessionId);
export const useSetAgentId = () => useStore(useStoreContext(), (s) => s.setAgentId);
export const useSetTemplateId = () => useStore(useStoreContext(), (s) => s.setTemplateId);
export const useAddFile = () => useStore(useStoreContext(), (s) => s.addFile);
export const useAddFiles = () => useStore(useStoreContext(), (s) => s.addFiles);
export const useAddCommand = () => useStore(useStoreContext(), (s) => s.addCommand);
export const useAddCommandLog = () => useStore(useStoreContext(), (s) => s.addCommandLog);
export const useSetCommandExitCode = () => useStore(useStoreContext(), (s) => s.setCommandExitCode);
export const useSetProject = () => useStore(useStoreContext(), (s) => s.setProject);
export const useSetProjectOwnership = () => useStore(useStoreContext(), (s) => s.setProjectOwnership);
export const useApplyStreamData = () => useStore(useStoreContext(), (s) => s.applyStreamData);
export const useReset = () => useStore(useStoreContext(), (s) => s.reset);
