import type { AgentProvider, ExecuteParams, StreamChunk } from "./types";
import { SANDBOX_BASE_PATH } from "./constants";
import { getTemplate } from "@/lib/templates";
import { DATA_PART_TYPES } from "@/lib/types";

interface CodexThreadStarted {
  type: "thread.started";
  thread_id: string;
}

interface CodexTurnStarted {
  type: "turn.started";
}

interface CodexTurnCompleted {
  type: "turn.completed";
  usage?: {
    input_tokens: number;
    cached_input_tokens?: number;
    output_tokens: number;
  };
}

interface CodexTurnFailed {
  type: "turn.failed";
  error?: string;
}

interface CodexItemStarted {
  type: "item.started";
  item: CodexItem;
}

interface CodexItemCompleted {
  type: "item.completed";
  item: CodexItem;
}

interface CodexError {
  type: "error";
  error: string;
}

type CodexItem =
  | { id: string; type: "agent_message"; text?: string; status?: string }
  | {
      id: string;
      type: "command_execution";
      command: string;
      status?: string;
      exit_code?: number;
      output?: string;
    }
  | {
      id: string;
      type: "file_change";
      path: string;
      status?: string;
      change_type?: string;
    }
  | { id: string; type: "reasoning"; text?: string }
  | { id: string; type: "mcp_tool_call"; tool_name: string; status?: string }
  | { id: string; type: "web_search"; query?: string; status?: string }
  | { id: string; type: "plan_update"; plan?: string };

type CodexMessage =
  | CodexThreadStarted
  | CodexTurnStarted
  | CodexTurnCompleted
  | CodexTurnFailed
  | CodexItemStarted
  | CodexItemCompleted
  | CodexError;

export class CodexAgentProvider implements AgentProvider {
  id = "codex";
  name = "Codex";
  description = "OpenAI's Codex";
  logo = "openai";

  async *execute(params: ExecuteParams): AsyncIterable<StreamChunk> {
    const { prompt, sandboxContext, sessionId, proxyConfig } = params;
    const { sandbox, templateId } = sandboxContext;

    const template = getTemplate(templateId);
    const instructions = template.instructions;

    const env: Record<string, string> = {
      AI_GATEWAY_API_KEY: proxyConfig.sessionId,
    };

    const fullPrompt = `${instructions}\n\nUSER REQUEST:\n${prompt}`;
    const escapedPrompt = fullPrompt.replace(/'/g, "'\\''");

    const cliArgs = [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-C",
      SANDBOX_BASE_PATH,
      "-c",
      'model_providers.vercel.name="Vercel AI Gateway Proxy"',
      "-c",
      `model_providers.vercel.base_url="${proxyConfig.baseUrl}/v1"`,
      "-c",
      'model_providers.vercel.env_key="AI_GATEWAY_API_KEY"',
      "-c",
      'model_providers.vercel.wire_api="chat"',
      "-c",
      'model_provider="vercel"',
      "-m",
      "openai/gpt-5.2-codex",
    ];

    if (sessionId) {
      cliArgs.push("resume", sessionId);
    }

    cliArgs.push(`'${escapedPrompt}'`);

    const command = `export PATH="$PATH:/root/.local/bin:/root/.bun/bin" && codex ${cliArgs.join(" ")}`;

    try {
      const cmd = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", command],
        cwd: SANDBOX_BASE_PATH,
        env,
        sudo: true,
        detached: true,
      });

      let lineBuffer = "";
      let gotResult = false;
      const totalUsage = { inputTokens: 0, outputTokens: 0 };

      for await (const log of cmd.logs()) {
        if (log.stream === "stdout") {
          lineBuffer += log.data;

          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const message = JSON.parse(line) as CodexMessage;
              const chunks = this.convertToStreamChunks(message);
              for (const chunk of chunks) {
                yield chunk;
              }

              if (message.type === "turn.completed" && message.usage) {
                totalUsage.inputTokens +=
                  message.usage.input_tokens +
                  (message.usage.cached_input_tokens ?? 0);
                totalUsage.outputTokens += message.usage.output_tokens;
                gotResult = true;
              }
            } catch {}
          }
        }
      }

      if (lineBuffer.trim()) {
        try {
          const message = JSON.parse(lineBuffer) as CodexMessage;
          const chunks = this.convertToStreamChunks(message);
          for (const chunk of chunks) {
            yield chunk;
          }
          if (message.type === "turn.completed" && message.usage) {
            totalUsage.inputTokens +=
              message.usage.input_tokens +
              (message.usage.cached_input_tokens ?? 0);
            totalUsage.outputTokens += message.usage.output_tokens;
            gotResult = true;
          }
        } catch {}
      }

      const finished = await cmd.wait();

      if (gotResult) {
        yield {
          type: "message-end",
          usage: totalUsage,
        };
      } else if (finished.exitCode !== 0) {
        const stderr = await finished.stderr();
        yield {
          type: "error",
          message: `Codex CLI exited with code ${finished.exitCode}${stderr ? `: ${stderr.slice(0, 200)}` : ""}`,
          code: "cli_error",
        };
      } else {
        // Exit code 0 but no result - might have been interrupted or incomplete
        yield {
          type: "message-end",
          usage: totalUsage,
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

  private convertToStreamChunks(message: CodexMessage): StreamChunk[] {
    const chunks: StreamChunk[] = [];

    switch (message.type) {
      case "thread.started":
        chunks.push({
          type: "message-start",
          id: message.thread_id,
          role: "assistant",
          sessionId: message.thread_id,
        });
        chunks.push({
          type: "data",
          dataType: DATA_PART_TYPES.AGENT_STATUS,
          data: { status: "thinking", message: "Codex started" },
        });
        break;

      case "turn.started":
        chunks.push({
          type: "data",
          dataType: DATA_PART_TYPES.AGENT_STATUS,
          data: { status: "thinking", message: "Processing..." },
        });
        break;

      case "item.started":
        chunks.push(...this.convertItemToChunks(message.item, "started"));
        break;

      case "item.completed":
        chunks.push(...this.convertItemToChunks(message.item, "completed"));
        break;

      case "turn.completed":
        chunks.push({
          type: "data",
          dataType: DATA_PART_TYPES.AGENT_STATUS,
          data: { status: "done", message: "Turn completed" },
        });
        break;

      case "turn.failed":
        chunks.push({
          type: "error",
          message: message.error || "Turn failed",
          code: "turn_failed",
        });
        break;

      case "error":
        chunks.push({
          type: "error",
          message: message.error,
          code: "codex_error",
        });
        break;
    }

    return chunks;
  }

  private convertItemToChunks(
    item: CodexItem,
    phase: "started" | "completed",
  ): StreamChunk[] {
    const chunks: StreamChunk[] = [];

    switch (item.type) {
      case "agent_message":
        if (phase === "completed" && item.text) {
          chunks.push({ type: "text-delta", text: item.text });
        }
        break;

      case "reasoning":
        if (phase === "completed" && item.text) {
          chunks.push({ type: "reasoning-delta", text: item.text });
        }
        break;

      case "command_execution":
        if (phase === "started") {
          chunks.push({
            type: "tool-start",
            toolCallId: item.id,
            toolName: "Bash",
          });
          // Emit tool-input-delta so UI can show what command is running
          chunks.push({
            type: "tool-input-delta",
            toolCallId: item.id,
            input: JSON.stringify({ command: item.command }),
          });
          chunks.push({
            type: "data",
            dataType: DATA_PART_TYPES.AGENT_STATUS,
            data: { status: "tool-use", message: `Running: ${item.command}` },
          });
        } else if (phase === "completed") {
          chunks.push({
            type: "tool-result",
            toolCallId: item.id,
            output: item.output || `Exit code: ${item.exit_code ?? 0}`,
            isError: (item.exit_code ?? 0) !== 0,
          });
          if (item.output) {
            chunks.push({
              type: "data",
              dataType: DATA_PART_TYPES.COMMAND_OUTPUT,
              data: {
                command: item.command,
                output: item.output,
                stream: "stdout",
                exitCode: item.exit_code,
              },
            });
          }
        }
        break;

      case "file_change":
        if (phase === "started") {
          chunks.push({
            type: "tool-start",
            toolCallId: item.id,
            toolName: item.change_type === "create" ? "Write" : "Edit",
          });
          // Emit tool-input-delta so UI can show what file is being modified
          chunks.push({
            type: "tool-input-delta",
            toolCallId: item.id,
            input: JSON.stringify({ file_path: item.path }),
          });
        } else if (phase === "completed") {
          chunks.push({
            type: "data",
            dataType: DATA_PART_TYPES.FILE_WRITTEN,
            data: { path: item.path },
          });
          chunks.push({
            type: "tool-result",
            toolCallId: item.id,
            output: `File ${item.change_type || "modified"}: ${item.path}`,
          });
        }
        break;

      case "web_search":
        if (phase === "started") {
          chunks.push({
            type: "tool-start",
            toolCallId: item.id,
            toolName: "WebSearch",
          });
          // Emit tool-input-delta so UI can show search query
          if (item.query) {
            chunks.push({
              type: "tool-input-delta",
              toolCallId: item.id,
              input: JSON.stringify({ query: item.query }),
            });
          }
          chunks.push({
            type: "data",
            dataType: DATA_PART_TYPES.AGENT_STATUS,
            data: {
              status: "tool-use",
              message: `Searching: ${item.query || "..."}`,
            },
          });
        } else if (phase === "completed") {
          chunks.push({
            type: "tool-result",
            toolCallId: item.id,
            output: "Search completed",
          });
        }
        break;

      case "mcp_tool_call":
        if (phase === "started") {
          chunks.push({
            type: "tool-start",
            toolCallId: item.id,
            toolName: item.tool_name,
          });
          // Emit tool-input-delta so UI can show tool name
          chunks.push({
            type: "tool-input-delta",
            toolCallId: item.id,
            input: JSON.stringify({ tool_name: item.tool_name }),
          });
        } else if (phase === "completed") {
          chunks.push({
            type: "tool-result",
            toolCallId: item.id,
            output: "Tool call completed",
          });
        }
        break;

      case "plan_update":
        if (phase === "completed" && item.plan) {
          chunks.push({
            type: "data",
            dataType: DATA_PART_TYPES.AGENT_STATUS,
            data: { status: "thinking", message: "Plan updated" },
          });
        }
        break;
    }

    return chunks;
  }
}

export const codexAgent = new CodexAgentProvider();
