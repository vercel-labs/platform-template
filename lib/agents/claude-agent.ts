import type { AgentProvider, ExecuteParams, StreamChunk } from "./types";
import { SANDBOX_INSTRUCTIONS, SANDBOX_BASE_PATH } from "./constants";
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

type ClaudeMessage =
  | ClaudeSystemMessage
  | ClaudeAssistantMessage
  | ClaudeUserMessage
  | ClaudeResultMessage;

export class ClaudeAgentProvider implements AgentProvider {
  id = "claude";
  name = "Claude Code";
  description = "Claude Code running natively in the sandbox";

  async *execute(params: ExecuteParams): AsyncIterable<StreamChunk> {
    const { prompt, sandboxContext, sessionId, proxyConfig } = params;
    const { sandbox } = sandboxContext;

    const env: Record<string, string> = {
      ANTHROPIC_BASE_URL: proxyConfig.baseUrl,
      ANTHROPIC_API_KEY: proxyConfig.sessionId,
    };

    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const escapedInstructions = SANDBOX_INSTRUCTIONS.replace(/'/g, "'\\''");

    const cliArgs = [
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
      "--append-system-prompt",
      `'${escapedInstructions}'`,
    ];

    if (sessionId) {
      cliArgs.push("--resume", sessionId);
    }

    cliArgs.push(`'${escapedPrompt}'`);

    // Run without sudo because claude CLI refuses --dangerously-skip-permissions with root
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
              // Non-JSON lines are expected (progress indicators, blank lines)
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
            chunks.push({ type: "text-delta", text: block.text });
          } else if (block.type === "tool_use") {
            chunks.push({
              type: "tool-start",
              toolCallId: block.id,
              toolName: block.name,
            });

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
}

export const claudeAgent = new ClaudeAgentProvider();
