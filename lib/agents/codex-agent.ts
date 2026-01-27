/**
 * Codex Agent Provider
 *
 * Runs OpenAI Codex CLI directly inside the Vercel Sandbox.
 * This approach:
 * 1. Uses the pre-installed `codex` CLI from the snapshot
 * 2. Passes API credentials via environment variables
 * 3. Streams the JSONL output in real-time using sandbox.logs()
 * 4. Lets Codex use its native tools (shell, file edits, etc.)
 */

import type {
  AgentProvider,
  ExecuteParams,
  StreamChunk,
} from "./types";

// ============================================================================
// System Prompt - Prepended to user prompts for sandbox context
// ============================================================================

const SANDBOX_INSTRUCTIONS = `
SANDBOX ENVIRONMENT:
- You are in a Vercel Sandbox at /vercel/sandbox
- Next.js (latest), React 19, Tailwind CSS, TypeScript are pre-installed
- The dev server is ALREADY RUNNING on port 3000 - the preview updates automatically
- shadcn/ui is configured - add components with: npx shadcn@latest add button

PROJECT STRUCTURE:
/vercel/sandbox/
  src/app/page.tsx      <- EDIT THIS for your app's main content
  src/app/layout.tsx    <- Root layout (html, body, providers)
  src/app/globals.css   <- Global styles, Tailwind imports
  src/lib/utils.ts      <- cn() utility for className merging
  src/components/       <- Create this folder for your components

WORKFLOW:
1. Edit src/app/page.tsx - changes appear in preview immediately
2. Add shadcn components: npx shadcn@latest add button card dialog
3. New routes: create src/app/about/page.tsx for /about

CRITICAL RULES:
- NEVER run npm install, npm run dev, or create-next-app
- NEVER create package.json - it exists
- NEVER start the dev server - it's already running
- Just edit files and the preview updates automatically
`;

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
  | { id: string; type: "command_execution"; command: string; status?: string; exit_code?: number; output?: string }
  | { id: string; type: "file_change"; path: string; status?: string; change_type?: string }
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
    const { prompt, sandboxContext, sessionId } = params;
    const { sandbox } = sandboxContext;

    // Build environment variables for the CLI
    const env: Record<string, string> = {};
    
    // Determine if using AI Gateway or direct API key
    const useAIGateway = !!process.env.VERCEL_OIDC_TOKEN;
    
    if (useAIGateway) {
      // Use Vercel AI Gateway with OIDC token
      // Codex needs AI_GATEWAY_API_KEY env var for the custom provider
      env.AI_GATEWAY_API_KEY = process.env.VERCEL_OIDC_TOKEN;
    } else if (process.env.OPENAI_API_KEY) {
      // Use direct OpenAI API key
      env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    } else {
      yield {
        type: "error",
        message: "No API key configured. Set VERCEL_OIDC_TOKEN or OPENAI_API_KEY.",
        code: "auth",
      };
      return;
    }

    // Build the CLI command
    // Escape the prompt for shell (replace single quotes)
    const fullPrompt = `${SANDBOX_INSTRUCTIONS}\n\nUSER REQUEST:\n${prompt}`;
    const escapedPrompt = fullPrompt.replace(/'/g, "'\\''");
    
    const cliArgs = [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-C", "/vercel/sandbox",
    ];
    
    // Configure AI Gateway provider if using OIDC token
    // This sets up a custom "vercel" provider with wire_api="chat"
    if (useAIGateway) {
      cliArgs.push(
        "-c", 'model_providers.vercel.name="Vercel AI Gateway"',
        "-c", 'model_providers.vercel.base_url="https://ai-gateway.vercel.sh/v1"',
        "-c", 'model_providers.vercel.env_key="AI_GATEWAY_API_KEY"',
        "-c", 'model_providers.vercel.wire_api="chat"',
        "-c", 'model_provider="vercel"',
        "-m", "openai/gpt-5.2-codex",
      );
    }
    
    // Resume session if provided
    if (sessionId) {
      cliArgs.push("resume", sessionId);
    }
    
    // Add the prompt
    cliArgs.push(`'${escapedPrompt}'`);

    const command = `source ~/.bashrc 2>/dev/null; codex ${cliArgs.join(" ")}`;

    console.log(`[codex-agent] Running: codex exec --json ...`);
    console.log(`[codex-agent] Prompt: ${prompt.substring(0, 100)}...`);

    try {
      // Start the command (detached so we can stream logs)
      const cmd = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", command],
        cwd: "/vercel/sandbox",
        env,
        detached: true,
      });

      // Buffer for incomplete lines (JSONL can be split across chunks)
      let lineBuffer = "";
      let threadId: string | undefined;
      let gotResult = false;
      let totalUsage = { inputTokens: 0, outputTokens: 0 };

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
              
              for (const chunk of this.convertToStreamChunks(message, threadId)) {
                yield chunk;
                
                // Capture thread ID
                if (message.type === "thread.started") {
                  threadId = message.thread_id;
                }
                
                // Accumulate usage
                if (message.type === "turn.completed" && message.usage) {
                  totalUsage.inputTokens += message.usage.input_tokens + (message.usage.cached_input_tokens ?? 0);
                  totalUsage.outputTokens += message.usage.output_tokens;
                  gotResult = true;
                }
              }
            } catch (parseError) {
              // Skip non-JSON lines (might be debug output)
              console.log(`[codex-agent] Non-JSON line: ${line.substring(0, 100)}`);
            }
          }
        } else if (log.stream === "stderr") {
          // Codex streams progress to stderr, log it
          console.log(`[codex-agent] stderr: ${log.data}`);
        }
      }

      // Process any remaining content in buffer
      if (lineBuffer.trim()) {
        try {
          const message = JSON.parse(lineBuffer) as CodexMessage;
          for (const chunk of this.convertToStreamChunks(message, threadId)) {
            yield chunk;
          }
          if (message.type === "turn.completed" && message.usage) {
            totalUsage.inputTokens += message.usage.input_tokens + (message.usage.cached_input_tokens ?? 0);
            totalUsage.outputTokens += message.usage.output_tokens;
            gotResult = true;
          }
        } catch {
          console.log(`[codex-agent] Final buffer not JSON: ${lineBuffer.substring(0, 100)}`);
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

  private *convertToStreamChunks(message: CodexMessage, threadId?: string): Generator<StreamChunk> {
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
          dataType: "agent-status",
          data: { status: "thinking", message: "Codex started" },
        };
        break;

      case "turn.started":
        yield {
          type: "data",
          dataType: "agent-status",
          data: { status: "thinking", message: "Processing..." },
        };
        break;

      case "item.started":
        for (const chunk of this.convertItemToChunks(message.item, "started")) {
          yield chunk;
        }
        break;

      case "item.completed":
        for (const chunk of this.convertItemToChunks(message.item, "completed")) {
          yield chunk;
        }
        break;

      case "turn.completed":
        yield {
          type: "data",
          dataType: "agent-status",
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
            dataType: "agent-status",
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
              dataType: "command-output",
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
            dataType: "file-written",
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
            dataType: "agent-status",
            data: { status: "tool-use", message: `Searching: ${item.query || "..."}` },
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
            dataType: "agent-status",
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
