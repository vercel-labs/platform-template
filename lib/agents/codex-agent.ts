/**
 * Codex Agent Provider
 *
 * Runs OpenAI Codex CLI directly inside the Vercel Sandbox.
 * This approach:
 * 1. Uses the pre-installed `codex` CLI from the snapshot
 * 2. Routes API requests through our proxy (which swaps session ID for OIDC token)
 * 3. Streams the JSONL output in real-time using sandbox.logs()
 * 4. Lets Codex use its native tools (shell, file edits, etc.)
 */

import type { AgentProvider, ExecuteParams, StreamChunk } from "./types";
import { SANDBOX_INSTRUCTIONS, SANDBOX_BASE_PATH } from "./constants";
import { DATA_PART_TYPES } from "@/lib/types";

// ============================================================================
// Types for Codex CLI JSON output (--json flag)
// ============================================================================

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

// ============================================================================
// Codex Agent Provider
// ============================================================================

export class CodexAgentProvider implements AgentProvider {
  id = "codex";
  name = "Codex";
  description = "OpenAI Codex running natively in the sandbox";

  /**
   * Execute a prompt by running the Codex CLI inside the sandbox.
   * Yields StreamChunk objects for streaming to the client.
   */
  async *execute(params: ExecuteParams): AsyncIterable<StreamChunk> {
    const { prompt, sandboxContext, sessionId, proxyConfig } = params;
    const { sandbox } = sandboxContext;

    // Build environment variables for the CLI
    // Route through the proxy - it swaps session ID for OIDC token
    const env: Record<string, string> = {
      AI_GATEWAY_API_KEY: proxyConfig.sessionId,
    };

    // Build the CLI command
    // Escape the prompt for shell (replace single quotes)
    const fullPrompt = `${SANDBOX_INSTRUCTIONS}\n\nUSER REQUEST:\n${prompt}`;
    const escapedPrompt = fullPrompt.replace(/'/g, "'\\''");

    const cliArgs = [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-C",
      SANDBOX_BASE_PATH,
      // Configure proxy as custom provider
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

    // Resume session if provided
    if (sessionId) {
      cliArgs.push("resume", sessionId);
    }

    // Add the prompt
    cliArgs.push(`'${escapedPrompt}'`);

    const command = `source ~/.bashrc 2>/dev/null; codex ${cliArgs.join(" ")}`;

    try {
      // Start the command (detached so we can stream logs)
      const cmd = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", command],
        cwd: SANDBOX_BASE_PATH,
        env,
        detached: true,
      });

      // Buffer for incomplete lines (JSONL can be split across chunks)
      let lineBuffer = "";
      let threadId: string | undefined;
      let gotResult = false;
      const totalUsage = { inputTokens: 0, outputTokens: 0 };

      // Stream logs in real-time
      for await (const log of cmd.logs()) {
        if (log.stream === "stdout") {
          // Append to buffer and process complete lines
          lineBuffer += log.data;

          // Process all complete lines
          const lines = lineBuffer.split("\n");
          // Keep the last incomplete line in the buffer
          lineBuffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const message = JSON.parse(line) as CodexMessage;

              for (const chunk of this.convertToStreamChunks(message)) {
                yield chunk;

                // Capture thread ID
                if (message.type === "thread.started") {
                  threadId = message.thread_id;
                }

                // Accumulate usage
                if (message.type === "turn.completed" && message.usage) {
                  totalUsage.inputTokens +=
                    message.usage.input_tokens +
                    (message.usage.cached_input_tokens ?? 0);
                  totalUsage.outputTokens += message.usage.output_tokens;
                  gotResult = true;
                }
              }
            } catch {
              // Skip non-JSON lines (might be debug output)
            }
          }
        }
      }

      // Process any remaining content in buffer
      if (lineBuffer.trim()) {
        try {
          const message = JSON.parse(lineBuffer) as CodexMessage;
          for (const chunk of this.convertToStreamChunks(message)) {
            yield chunk;
          }
          if (message.type === "turn.completed" && message.usage) {
            totalUsage.inputTokens +=
              message.usage.input_tokens +
              (message.usage.cached_input_tokens ?? 0);
            totalUsage.outputTokens += message.usage.output_tokens;
            gotResult = true;
          }
        } catch {
          // Final buffer not JSON, ignore
        }
      }

      // Wait for command to finish and check exit code
      const finished = await cmd.wait();

      // Emit final message-end with accumulated usage
      if (gotResult) {
        yield {
          type: "message-end",
          usage: totalUsage,
        };
      } else if (finished.exitCode !== 0) {
        yield {
          type: "error",
          message: `Codex CLI exited with code ${finished.exitCode}`,
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

  // ============================================================================
  // Convert Codex CLI messages to StreamChunks
  // ============================================================================

  private *convertToStreamChunks(message: CodexMessage): Generator<StreamChunk> {
    switch (message.type) {
      case "thread.started":
        yield {
          type: "message-start",
          id: message.thread_id,
          role: "assistant",
          sessionId: message.thread_id,
        };
        yield {
          type: "data",
          dataType: DATA_PART_TYPES.AGENT_STATUS,
          data: { status: "thinking", message: "Codex started" },
        };
        break;

      case "turn.started":
        yield {
          type: "data",
          dataType: DATA_PART_TYPES.AGENT_STATUS,
          data: { status: "thinking", message: "Processing..." },
        };
        break;

      case "item.started":
        for (const chunk of this.convertItemToChunks(message.item, "started")) {
          yield chunk;
        }
        break;

      case "item.completed":
        for (const chunk of this.convertItemToChunks(
          message.item,
          "completed"
        )) {
          yield chunk;
        }
        break;

      case "turn.completed":
        yield {
          type: "data",
          dataType: DATA_PART_TYPES.AGENT_STATUS,
          data: { status: "done", message: "Turn completed" },
        };
        break;

      case "turn.failed":
        yield {
          type: "error",
          message: message.error || "Turn failed",
          code: "turn_failed",
        };
        break;

      case "error":
        yield {
          type: "error",
          message: message.error,
          code: "codex_error",
        };
        break;
    }
  }

  /**
   * Convert Codex item events to StreamChunks
   */
  private *convertItemToChunks(
    item: CodexItem,
    phase: "started" | "completed"
  ): Generator<StreamChunk> {
    switch (item.type) {
      case "agent_message":
        if (phase === "completed" && item.text) {
          yield { type: "text-delta", text: item.text };
        }
        break;

      case "reasoning":
        if (phase === "completed" && item.text) {
          yield { type: "reasoning-delta", text: item.text };
        }
        break;

      case "command_execution":
        if (phase === "started") {
          yield {
            type: "tool-start",
            toolCallId: item.id,
            toolName: "Bash",
          };
          yield {
            type: "data",
            dataType: DATA_PART_TYPES.AGENT_STATUS,
            data: { status: "tool-use", message: `Running: ${item.command}` },
          };
        } else if (phase === "completed") {
          yield {
            type: "tool-result",
            toolCallId: item.id,
            output: item.output || `Exit code: ${item.exit_code ?? 0}`,
            isError: (item.exit_code ?? 0) !== 0,
          };
          // Emit command output data
          if (item.output) {
            yield {
              type: "data",
              dataType: DATA_PART_TYPES.COMMAND_OUTPUT,
              data: {
                command: item.command,
                output: item.output,
                stream: "stdout",
                exitCode: item.exit_code,
              },
            };
          }
        }
        break;

      case "file_change":
        if (phase === "started") {
          yield {
            type: "tool-start",
            toolCallId: item.id,
            toolName: item.change_type === "create" ? "Write" : "Edit",
          };
        } else if (phase === "completed") {
          yield {
            type: "data",
            dataType: DATA_PART_TYPES.FILE_WRITTEN,
            data: { path: item.path },
          };
          yield {
            type: "tool-result",
            toolCallId: item.id,
            output: `File ${item.change_type || "modified"}: ${item.path}`,
          };
        }
        break;

      case "web_search":
        if (phase === "started") {
          yield {
            type: "tool-start",
            toolCallId: item.id,
            toolName: "WebSearch",
          };
          yield {
            type: "data",
            dataType: DATA_PART_TYPES.AGENT_STATUS,
            data: {
              status: "tool-use",
              message: `Searching: ${item.query || "..."}`,
            },
          };
        } else if (phase === "completed") {
          yield {
            type: "tool-result",
            toolCallId: item.id,
            output: "Search completed",
          };
        }
        break;

      case "mcp_tool_call":
        if (phase === "started") {
          yield {
            type: "tool-start",
            toolCallId: item.id,
            toolName: item.tool_name,
          };
        } else if (phase === "completed") {
          yield {
            type: "tool-result",
            toolCallId: item.id,
            output: "Tool call completed",
          };
        }
        break;

      case "plan_update":
        if (phase === "completed" && item.plan) {
          yield {
            type: "data",
            dataType: DATA_PART_TYPES.AGENT_STATUS,
            data: { status: "thinking", message: "Plan updated" },
          };
        }
        break;
    }
  }
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const codexAgent = new CodexAgentProvider();
