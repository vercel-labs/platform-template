import type { AgentProvider, ExecuteParams, StreamChunk } from "./types";
import { SANDBOX_BASE_PATH } from "./constants";
import { getTemplate } from "@/lib/templates";
import { DATA_PART_TYPES } from "@/lib/types";

interface ClaudeSystemMessage {
  type: "system";
  subtype: "init";
  session_id: string;
  tools: string[];
  model: string;
  uuid: string;
}

interface ClaudeAssistantMessage {
  type: "assistant";
  message: {
    id: string;
    role: "assistant";
    content: Array<
      | { type: "text"; text: string }
      | {
          type: "tool_use";
          id: string;
          name: string;
          input: Record<string, unknown>;
        }
    >;
    model: string;
  };
  session_id: string;
  uuid: string;
}

interface ClaudeUserMessage {
  type: "user";
  message: {
    role: "user";
    content: Array<
      | { type: "text"; text: string }
      | {
          type: "tool_result";
          tool_use_id: string;
          content: string;
          is_error?: boolean;
        }
    >;
  };
}

interface ClaudeResultMessage {
  type: "result";
  subtype: "success" | "error_during_execution" | "error_max_turns";
  result?: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  session_id: string;
  errors?: string[];
}

interface ClaudeStreamEvent {
  type: "stream_event";
  event:
    | { type: "message_start"; message: { id: string } }
    | { type: "content_block_start"; index: number; content_block: { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } }
    | { type: "content_block_delta"; index: number; delta: { type: "text_delta"; text: string } | { type: "input_json_delta"; partial_json: string } }
    | { type: "content_block_stop"; index: number }
    | { type: "message_delta"; delta: { stop_reason: string } }
    | { type: "message_stop" };
  session_id: string;
  parent_tool_use_id: string | null;
  uuid: string;
}

type ClaudeMessage =
  | ClaudeSystemMessage
  | ClaudeAssistantMessage
  | ClaudeUserMessage
  | ClaudeResultMessage
  | ClaudeStreamEvent;

export class ClaudeAgentProvider implements AgentProvider {
  id = "claude";
  name = "Claude Code";
  description = "Anthropic's Claude Code";
  logo = "/claude.svg";

  // Track current streaming tool state
  private currentToolId: string | null = null;
  private currentToolName: string | null = null;
  private currentToolInput: string = "";
  // Track tool IDs we've already emitted via stream_event to avoid duplicates
  private emittedToolIds: Set<string> = new Set();
  // Track if we've received stream events (to skip duplicate content in assistant message)
  private hasStreamEvents: boolean = false;

  async *execute(params: ExecuteParams): AsyncIterable<StreamChunk> {
    // Reset mutable state from previous calls (singleton instance is reused)
    this.currentToolId = null;
    this.currentToolName = null;
    this.currentToolInput = "";
    this.emittedToolIds = new Set();
    this.hasStreamEvents = false;

    const { prompt, sandboxContext, sessionId, proxyConfig } = params;
    const { sandbox, templateId } = sandboxContext;

    const template = getTemplate(templateId);
    const instructions = template.instructions;

    const env: Record<string, string> = {
      ANTHROPIC_BASE_URL: proxyConfig.baseUrl,
      ANTHROPIC_API_KEY: proxyConfig.sessionId,
    };

    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const escapedInstructions = instructions.replace(/'/g, "'\\''");

    const cliArgs = [
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--dangerously-skip-permissions",
      "--append-system-prompt",
      `'${escapedInstructions}'`,
    ];

    if (sessionId) {
      cliArgs.push("--resume", sessionId);
    }

    cliArgs.push(`'${escapedPrompt}'`);

    const command = `export PATH="$HOME/.local/bin:$PATH" && claude ${cliArgs.join(" ")}`;

    try {
      const cmd = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", command],
        cwd: SANDBOX_BASE_PATH,
        env,
        detached: true,
      });

      let lineBuffer = "";
      let stderrBuffer = "";
      let gotResult = false;

      for await (const log of cmd.logs()) {
        if (log.stream === "stdout") {
          lineBuffer += log.data;

          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const message = JSON.parse(line) as ClaudeMessage;
              const chunks = this.convertToStreamChunks(message);
              for (const chunk of chunks) {
                yield chunk;
              }

              if (message.type === "result") {
                gotResult = true;
              }
            } catch {
            }
          }
        } else if (log.stream === "stderr") {
          stderrBuffer += log.data;
        }
      }

      if (lineBuffer.trim()) {
        try {
          const message = JSON.parse(lineBuffer) as ClaudeMessage;
          const chunks = this.convertToStreamChunks(message);
          for (const chunk of chunks) {
            yield chunk;
          }
          if (message.type === "result") {
            gotResult = true;
          }
        } catch {}
      }

      const finished = await cmd.wait();

      if (finished.exitCode !== 0 && !gotResult) {
        const errorOutput =
          stderrBuffer || (await finished.stderr().catch(() => ""));
        console.error(
          `[claude-agent] CLI exited with code ${finished.exitCode}:`,
          errorOutput,
        );
        yield {
          type: "error",
          message: `Claude CLI exited with code ${finished.exitCode}${errorOutput ? `: ${errorOutput.slice(0, 500)}` : ""}`,
          code: "cli_error",
        };
      }
    } catch (error) {
      yield {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        code: "execution_error",
      };
    }
  }

  private convertToStreamChunks(message: ClaudeMessage): StreamChunk[] {
    const chunks: StreamChunk[] = [];

    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          chunks.push({
            type: "message-start",
            id: message.uuid,
            role: "assistant",
            sessionId: message.session_id,
          });
          chunks.push({
            type: "data",
            dataType: DATA_PART_TYPES.AGENT_STATUS,
            data: { status: "thinking", message: "Agent initialized" },
          });
        }
        break;

      case "assistant":
        for (const block of message.message.content) {
          if (block.type === "text") {
            // Skip text if we've been streaming via stream_event
            // The assistant message contains the full text, but we already emitted deltas
            // Only emit if we haven't seen any stream events (fallback for non-partial mode)
            if (!this.hasStreamEvents) {
              chunks.push({ type: "text-delta", text: block.text });
            }
          } else if (block.type === "tool_use") {
            // Skip if we already emitted this tool via stream_event
            if (this.emittedToolIds.has(block.id)) {
              continue;
            }

            chunks.push({
              type: "tool-start",
              toolCallId: block.id,
              toolName: block.name,
            });

            // Emit tool-input-delta so UI can show what the tool is doing
            if (Object.keys(block.input).length > 0) {
              chunks.push({
                type: "tool-input-delta",
                toolCallId: block.id,
                input: JSON.stringify(block.input),
              });
            }

            if (block.name === "Write" || block.name === "Edit") {
              const filePath = block.input.file_path as string | undefined;
              if (filePath) {
                chunks.push({
                  type: "data",
                  dataType: DATA_PART_TYPES.FILE_WRITTEN,
                  data: { path: filePath },
                });
              }
            }
          }
        }
        break;

      case "user":
        for (const block of message.message.content) {
          if (block.type === "tool_result") {
            chunks.push({
              type: "tool-result",
              toolCallId: block.tool_use_id,
              output:
                typeof block.content === "string"
                  ? block.content
                  : JSON.stringify(block.content),
              isError: block.is_error,
            });
          }
        }
        break;

      case "stream_event":
        chunks.push(...this.handleStreamEvent(message));
        break;

      case "result":
        if (message.subtype === "success") {
          chunks.push({
            type: "message-end",
            usage: {
              inputTokens:
                message.usage.input_tokens +
                (message.usage.cache_read_input_tokens ?? 0),
              outputTokens: message.usage.output_tokens,
            },
          });
        } else {
          chunks.push({
            type: "error",
            message:
              message.errors?.join(", ") || `Agent error: ${message.subtype}`,
            code: message.subtype,
          });
          chunks.push({
            type: "message-end",
            usage: {
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
            },
          });
        }
        break;
    }

    return chunks;
  }

  private handleStreamEvent(message: ClaudeStreamEvent): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    const event = message.event;
    this.hasStreamEvents = true;

    switch (event.type) {
      case "content_block_start":
        if (event.content_block.type === "tool_use") {
          // Tool is starting - emit tool-start immediately
          this.currentToolId = event.content_block.id;
          this.currentToolName = event.content_block.name;
          this.currentToolInput = "";
          this.emittedToolIds.add(event.content_block.id);
          
          chunks.push({
            type: "tool-start",
            toolCallId: event.content_block.id,
            toolName: event.content_block.name,
          });
        }
        break;

      case "content_block_delta":
        if (event.delta.type === "text_delta") {
          // Streaming text
          chunks.push({ type: "text-delta", text: event.delta.text });
        } else if (event.delta.type === "input_json_delta" && this.currentToolId) {
          // Streaming tool input - accumulate and emit delta
          this.currentToolInput += event.delta.partial_json;
          chunks.push({
            type: "tool-input-delta",
            toolCallId: this.currentToolId,
            input: event.delta.partial_json,
          });
        }
        break;

      case "content_block_stop":
        if (this.currentToolId && this.currentToolName) {
          // Tool input is complete - check if it's a Write/Edit for FILE_WRITTEN event
          try {
            const input = JSON.parse(this.currentToolInput);
            if (
              (this.currentToolName === "Write" || this.currentToolName === "Edit") &&
              input.file_path
            ) {
              chunks.push({
                type: "data",
                dataType: DATA_PART_TYPES.FILE_WRITTEN,
                data: { path: input.file_path },
              });
            }
          } catch {
            // Ignore JSON parse errors for incomplete input
          }
          
          // Reset tool state
          this.currentToolId = null;
          this.currentToolName = null;
          this.currentToolInput = "";
        }
        break;
    }

    return chunks;
  }
}
