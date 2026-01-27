/**
 * Claude Agent Provider
 *
 * Runs Claude Code CLI directly inside the Vercel Sandbox.
 * This approach:
 * 1. Uses the pre-installed `claude` CLI from the snapshot
 * 2. Routes API requests through our proxy (which swaps session ID for OIDC token)
 * 3. Streams the NDJSON output in real-time using sandbox.logs()
 * 4. Lets Claude use its native tools (Read, Write, Edit, Bash, etc.)
 */

import type { AgentProvider, ExecuteParams, StreamChunk } from "./types";
import { SANDBOX_INSTRUCTIONS, SANDBOX_BASE_PATH } from "./constants";
import { DATA_PART_TYPES } from "@/lib/types";

// ============================================================================
// Types for Claude Code stream-json output
// ============================================================================

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

// ============================================================================
// Claude Agent Provider
// ============================================================================

export class ClaudeAgentProvider implements AgentProvider {
  id = "claude";
  name = "Claude Code";
  description = "Claude Code running natively in the sandbox";

  /**
   * Execute a prompt by running the Claude CLI inside the sandbox.
   * Yields StreamChunk objects for streaming to the client.
   */
  async *execute(params: ExecuteParams): AsyncIterable<StreamChunk> {
    const { prompt, sandboxContext, sessionId, proxyConfig } = params;
    const { sandbox } = sandboxContext;

    // Build environment variables for the CLI
    // Always route through the proxy - it swaps session ID for OIDC token
    const env: Record<string, string> = {
      ANTHROPIC_BASE_URL: proxyConfig.baseUrl,
      ANTHROPIC_API_KEY: proxyConfig.sessionId,
    };

    // Build the CLI command
    // Escape the prompt for shell (replace single quotes)
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

    // Resume session if provided
    if (sessionId) {
      cliArgs.push("--resume", sessionId);
    }

    // Add the prompt
    cliArgs.push(`'${escapedPrompt}'`);

    const command = `source ~/.bashrc 2>/dev/null; claude ${cliArgs.join(" ")}`;

    try {
      // Start the command (detached so we can stream logs)
      const cmd = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", command],
        cwd: SANDBOX_BASE_PATH,
        env,
        detached: true,
      });

      // Buffer for incomplete lines (NDJSON can be split across chunks)
      let lineBuffer = "";
      let gotResult = false;

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
              const message = JSON.parse(line) as ClaudeMessage;
              const chunks = this.convertToStreamChunks(message);
              for (const chunk of chunks) {
                yield chunk;
              }

              if (message.type === "result") {
                gotResult = true;
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
          const message = JSON.parse(lineBuffer) as ClaudeMessage;
          const chunks = this.convertToStreamChunks(message);
          for (const chunk of chunks) {
            yield chunk;
          }
          if (message.type === "result") {
            gotResult = true;
          }
        } catch {
          // Final buffer not JSON, ignore
        }
      }

      // Wait for command to finish and check exit code
      const finished = await cmd.wait();

      // If exit code is non-zero and we didn't get a result message, emit error
      if (finished.exitCode !== 0 && !gotResult) {
        yield {
          type: "error",
          message: `Claude CLI exited with code ${finished.exitCode}`,
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
  // Convert Claude CLI messages to StreamChunks
  // ============================================================================

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

            // Emit data parts based on tool type
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
        // User messages contain tool results
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

// ============================================================================
// Export singleton instance
// ============================================================================

export const claudeAgent = new ClaudeAgentProvider();
