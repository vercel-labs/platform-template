/**
 * Claude Agent Provider
 *
 * Runs Claude Code CLI directly inside the Vercel Sandbox.
 * This approach:
 * 1. Uses the pre-installed `claude` CLI from the snapshot
 * 2. Passes API credentials via environment variables
 * 3. Streams the NDJSON output in real-time using sandbox.logs()
 * 4. Lets Claude use its native tools (Read, Write, Edit, Bash, etc.)
 */

import type {
  AgentProvider,
  ExecuteParams,
  StreamChunk,
} from "./types";

// ============================================================================
// System Prompt - Appended to Claude Code's default prompt
// ============================================================================

const SANDBOX_INSTRUCTIONS = `
SANDBOX ENVIRONMENT:
- You are in a Vercel Sandbox at /vercel/sandbox
- Next.js (latest), React 19, Tailwind CSS, TypeScript are pre-installed
- The dev server is ALREADY RUNNING on port 3000 - the preview updates automatically
- shadcn/ui is configured - add components with: npx shadcn@latest add button

PROJECT STRUCTURE:
/vercel/sandbox/
  src/app/page.tsx      ← EDIT THIS for your app's main content
  src/app/layout.tsx    ← Root layout (html, body, providers)
  src/app/globals.css   ← Global styles, Tailwind imports
  src/lib/utils.ts      ← cn() utility for className merging
  src/components/       ← Create this folder for your components

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
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
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
      | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
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
    const { prompt, sandboxContext, sessionId } = params;
    const { sandbox } = sandboxContext;

    // Build environment variables for the CLI
    const env: Record<string, string> = {};
    
    if (process.env.VERCEL_OIDC_TOKEN) {
      // Use Vercel AI Gateway
      env.ANTHROPIC_BASE_URL = "https://ai-gateway.vercel.sh";
      env.ANTHROPIC_AUTH_TOKEN = process.env.VERCEL_OIDC_TOKEN;
      env.ANTHROPIC_API_KEY = ""; // Must be empty for gateway
    } else if (process.env.ANTHROPIC_API_KEY) {
      // Use direct API key
      env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    } else {
      yield {
        type: "error",
        message: "No API key configured. Set VERCEL_OIDC_TOKEN or ANTHROPIC_API_KEY.",
        code: "auth",
      };
      return;
    }

    // Build the CLI command
    // Escape the prompt for shell (replace single quotes)
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const escapedInstructions = SANDBOX_INSTRUCTIONS.replace(/'/g, "'\\''");
    
    const cliArgs = [
      "--print",
      "--verbose",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
      "--append-system-prompt", `'${escapedInstructions}'`,
    ];
    
    // Resume session if provided
    if (sessionId) {
      cliArgs.push("--resume", sessionId);
    }
    
    // Add the prompt
    cliArgs.push(`'${escapedPrompt}'`);

    const command = `source ~/.bashrc 2>/dev/null; claude ${cliArgs.join(" ")}`;

    console.log(`[claude-agent] Running: claude --print --verbose --output-format stream-json ...`);
    console.log(`[claude-agent] Prompt: ${prompt.substring(0, 100)}...`);

    try {
      // Start the command (detached so we can stream logs)
      const cmd = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", command],
        cwd: "/vercel/sandbox",
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
              
              for (const chunk of this.convertToStreamChunks(message)) {
                yield chunk;
              }
              
              if (message.type === "result") {
                gotResult = true;
              }
            } catch (parseError) {
              // Skip non-JSON lines (might be debug output)
              console.log(`[claude-agent] Non-JSON line: ${line.substring(0, 100)}`);
            }
          }
        } else if (log.stream === "stderr") {
          console.log(`[claude-agent] stderr: ${log.data}`);
        }
      }

      // Process any remaining content in buffer
      if (lineBuffer.trim()) {
        try {
          const message = JSON.parse(lineBuffer) as ClaudeMessage;
          for (const chunk of this.convertToStreamChunks(message)) {
            yield chunk;
          }
          if (message.type === "result") {
            gotResult = true;
          }
        } catch {
          console.log(`[claude-agent] Final buffer not JSON: ${lineBuffer.substring(0, 100)}`);
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

  private *convertToStreamChunks(message: ClaudeMessage): Generator<StreamChunk> {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          yield {
            type: "message-start",
            id: message.uuid,
            role: "assistant",
            sessionId: message.session_id,
          };
          yield {
            type: "data",
            dataType: "agent-status",
            data: { status: "thinking", message: "Agent initialized" },
          };
        }
        break;

      case "assistant":
        for (const block of message.message.content) {
          if (block.type === "text") {
            yield { type: "text-delta", text: block.text };
          } else if (block.type === "tool_use") {
            yield {
              type: "tool-start",
              toolCallId: block.id,
              toolName: block.name,
            };
            
            // Emit data parts based on tool type
            if (block.name === "Write" || block.name === "Edit") {
              const filePath = block.input.file_path as string | undefined;
              if (filePath) {
                yield {
                  type: "data",
                  dataType: "file-written",
                  data: { path: filePath },
                };
              }
            }
          }
        }
        break;

      case "user":
        // User messages contain tool results
        for (const block of message.message.content) {
          if (block.type === "tool_result") {
            yield {
              type: "tool-result",
              toolCallId: block.tool_use_id,
              output: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
              isError: block.is_error,
            };
          }
        }
        break;

      case "result":
        if (message.subtype === "success") {
          yield {
            type: "message-end",
            usage: {
              inputTokens: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0),
              outputTokens: message.usage.output_tokens,
            },
          };
        } else {
          yield {
            type: "error",
            message: message.errors?.join(", ") || `Agent error: ${message.subtype}`,
            code: message.subtype,
          };
          yield {
            type: "message-end",
            usage: {
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
            },
          };
        }
        break;
    }
  }
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const claudeAgent = new ClaudeAgentProvider();
