import { z } from "zod";
import type { UIMessage, DataUIPart } from "ai";

export const DATA_PART_TYPES = {
  AGENT_STATUS: "agent-status",
  SANDBOX_STATUS: "sandbox-status",
  FILE_WRITTEN: "file-written",
  COMMAND_OUTPUT: "command-output",
  PREVIEW_URL: "preview-url",
} as const;

export type DataPartType =
  (typeof DATA_PART_TYPES)[keyof typeof DATA_PART_TYPES];

export const AgentStatusSchema = z.object({
  status: z.enum(["thinking", "tool-use", "done", "error"]),
  message: z.string().optional(),
});

export const SandboxStatusSchema = z.object({
  sandboxId: z.string().optional(),
  status: z.enum(["creating", "warming", "ready", "error"]),
  message: z.string().optional(),
  error: z.string().optional(),
});

export const FileWrittenSchema = z.object({
  path: z.string(),
});

export const CommandOutputSchema = z.object({
  command: z.string(),
  output: z.string(),
  stream: z.enum(["stdout", "stderr"]),
  exitCode: z.number().optional(),
});

export const PreviewUrlSchema = z.object({
  url: z.string(),
  port: z.number(),
});

export type AgentStatusData = z.infer<typeof AgentStatusSchema>;
export type SandboxStatusData = z.infer<typeof SandboxStatusSchema>;
export type FileWrittenData = z.infer<typeof FileWrittenSchema>;
export type CommandOutputData = z.infer<typeof CommandOutputSchema>;
export type PreviewUrlData = z.infer<typeof PreviewUrlSchema>;

export type DataPartPayload = {
  [DATA_PART_TYPES.AGENT_STATUS]: AgentStatusData;
  [DATA_PART_TYPES.SANDBOX_STATUS]: SandboxStatusData;
  [DATA_PART_TYPES.FILE_WRITTEN]: FileWrittenData;
  [DATA_PART_TYPES.COMMAND_OUTPUT]: CommandOutputData;
  [DATA_PART_TYPES.PREVIEW_URL]: PreviewUrlData;
};

export type DataPart = DataPartPayload;

export const DataPartSchemas = {
  [DATA_PART_TYPES.AGENT_STATUS]: AgentStatusSchema,
  [DATA_PART_TYPES.SANDBOX_STATUS]: SandboxStatusSchema,
  [DATA_PART_TYPES.FILE_WRITTEN]: FileWrittenSchema,
  [DATA_PART_TYPES.COMMAND_OUTPUT]: CommandOutputSchema,
  [DATA_PART_TYPES.PREVIEW_URL]: PreviewUrlSchema,
} as const;

export function parseDataPart<T extends DataPartType>(
  type: T,
  data: unknown,
): DataPartPayload[T] | null {
  const schema = DataPartSchemas[type];
  const result = schema.safeParse(data);
  return result.success ? (result.data as DataPartPayload[T]) : null;
}

export const UI_DATA_PART_TYPES = {
  AGENT_STATUS: `data-${DATA_PART_TYPES.AGENT_STATUS}`,
  SANDBOX_STATUS: `data-${DATA_PART_TYPES.SANDBOX_STATUS}`,
  FILE_WRITTEN: `data-${DATA_PART_TYPES.FILE_WRITTEN}`,
  COMMAND_OUTPUT: `data-${DATA_PART_TYPES.COMMAND_OUTPUT}`,
  PREVIEW_URL: `data-${DATA_PART_TYPES.PREVIEW_URL}`,
} as const;

export type UIDataPartType =
  (typeof UI_DATA_PART_TYPES)[keyof typeof UI_DATA_PART_TYPES];

export type MessageMetadata = {
  agentId?: string;
  model?: string;
  duration?: number;
};

export type ChatMessage = UIMessage<MessageMetadata, DataPartPayload>;

export type ChatDataPart = DataUIPart<DataPartPayload>;

export type { UIMessage, DataUIPart } from "ai";

// Stream event helpers
type DataEvent<T extends DataPartType> = {
  type: "data";
  dataType: T;
  data: DataPartPayload[T];
};

export const events = {
  sandboxStatus: (
    sandboxId: string,
    status: SandboxStatusData["status"],
    message?: string,
    error?: string,
  ): DataEvent<"sandbox-status"> => ({
    type: "data",
    dataType: DATA_PART_TYPES.SANDBOX_STATUS,
    data: { sandboxId, status, message, error },
  }),
  previewUrl: (url: string, port: number): DataEvent<"preview-url"> => ({
    type: "data",
    dataType: DATA_PART_TYPES.PREVIEW_URL,
    data: { url, port },
  }),
  fileWritten: (path: string): DataEvent<"file-written"> => ({
    type: "data",
    dataType: DATA_PART_TYPES.FILE_WRITTEN,
    data: { path },
  }),
  agentStatus: (
    status: AgentStatusData["status"],
    message?: string,
  ): DataEvent<"agent-status"> => ({
    type: "data",
    dataType: DATA_PART_TYPES.AGENT_STATUS,
    data: { status, message },
  }),
};
