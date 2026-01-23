/**
 * Claude Agent Provider
 *
 * Implements the AgentProvider interface using the Claude Agent SDK.
 * Handles conversion from SDK messages to StreamChunk internally.
 */

import {
  query,
  createSdkMcpServer,
  type SDKMessage,
  type SDKAssistantMessage,
  type SDKResultMessage,
  type SDKPartialAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type {
  AgentProvider,
  ExecuteParams,
  StreamChunk,
  SandboxContext,
} from "./types";

// ============================================================================
// System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are an AI coding assistant running in a Vercel Sandbox environment.

You have access to sandbox tools via MCP. Use the exact tool names as provided:
- mcp__sandbox__read_file: Read files from /vercel/sandbox
- mcp__sandbox__write_file: Write files to /vercel/sandbox  
- mcp__sandbox__run_command: Execute shell commands. Set background=true for dev servers, timeout=60000 for npm install.
- mcp__sandbox__list_files: List files in the sandbox
- mcp__sandbox__get_preview_url: Get the public URL for a running dev server (port 3000 or 5173)

When asked to build an application:
1. Create the necessary files (package.json, source files, etc.) using mcp__sandbox__write_file
2. For Vite projects, ALWAYS create vite.config.js with server.allowedHosts: true (required for sandbox preview):
   \`\`\`js
   import { defineConfig } from 'vite'
   export default defineConfig({
     server: { host: '0.0.0.0', allowedHosts: true }
   })
   \`\`\`
3. Install dependencies: mcp__sandbox__run_command with cmd="npm", args=["install"], timeout=60000
4. Start dev server in BACKGROUND: mcp__sandbox__run_command with cmd="npm", args=["run", "dev"], background=true
5. Get the preview URL: mcp__sandbox__get_preview_url with port=3000 (or 5173 for Vite)

IMPORTANT: 
- Always use background=true for dev servers (npm run dev, npm start, etc.) or they will hang!
- Always configure Vite with allowedHosts: true or the preview iframe won't work!

All file paths must be within /vercel/sandbox.`;

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Creates sandbox tools for the Claude Agent SDK.
 * These tools interact with the @vercel/sandbox instance.
 * 
 * Note: The handler signature must match SdkMcpToolDefinition which expects
 * (args: { [x: string]: unknown }, extra: unknown) => Promise<CallToolResult>
 */
function createSandboxTools(ctx: SandboxContext) {
  return [
    {
      name: "read_file",
      description: "Read a file from the sandbox filesystem",
      inputSchema: {
        path: z.string().describe("Absolute path within /vercel/sandbox"),
      },
      handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const path = args.path as string;
        if (!path.startsWith("/vercel/sandbox")) {
          return {
            content: [
              { type: "text" as const, text: "Error: Path must be within /vercel/sandbox" },
            ],
          };
        }
        try {
          const stream = await ctx.sandbox.readFile({ path });
          if (!stream) {
            return {
              content: [{ type: "text" as const, text: `Error: File not found: ${path}` }],
              isError: true,
            };
          }
          const chunks: Uint8Array[] = [];
          for await (const chunk of stream) {
            if (chunk instanceof Uint8Array) {
              chunks.push(chunk);
            } else if (Buffer.isBuffer(chunk)) {
              chunks.push(new Uint8Array(chunk));
            } else if (typeof chunk === "string") {
              chunks.push(new TextEncoder().encode(chunk));
            }
          }
          const content = new TextDecoder().decode(
            chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
          );
          return { content: [{ type: "text" as const, text: content }] };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    },
    {
      name: "write_file",
      description: "Write content to a file in the sandbox",
      inputSchema: {
        path: z.string().describe("Absolute path within /vercel/sandbox"),
        content: z.string().describe("Content to write to the file"),
      },
      handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const path = args.path as string;
        const content = args.content as string;
        if (!path.startsWith("/vercel/sandbox")) {
          return {
            content: [
              { type: "text" as const, text: "Error: Path must be within /vercel/sandbox" },
            ],
          };
        }
        try {
          await ctx.sandbox.writeFiles([
            { path, content: Buffer.from(content, "utf-8") },
          ]);
          return {
            content: [
              { type: "text" as const, text: `Wrote ${content.length} bytes to ${path}` },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    },
    {
      name: "run_command",
      description: "Execute a shell command in the sandbox. For long-running commands like dev servers, set background=true.",
      inputSchema: {
        cmd: z.string().describe("Command to run (e.g., 'npm', 'node')"),
        args: z.array(z.string()).optional().describe("Command arguments"),
        cwd: z.string().optional().describe("Working directory"),
        background: z.boolean().optional().describe("Run in background (for dev servers). Default false."),
        timeout: z.number().optional().describe("Timeout in ms. Default 30000. Set higher for npm install."),
      },
      handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const cmd = args.cmd as string;
        const cmdArgs = (args.args as string[] | undefined) ?? [];
        const cwd = args.cwd as string | undefined;
        const background = args.background as boolean | undefined;
        const timeout = (args.timeout as number | undefined) ?? 30000;
        
        try {
          if (background) {
            // For background commands (dev servers), start and don't wait
            const result = ctx.sandbox.runCommand({
              cmd,
              args: cmdArgs,
              cwd: cwd ?? "/vercel/sandbox",
            });
            // Don't await - let it run in background
            // Just give it a moment to start
            await new Promise((resolve) => setTimeout(resolve, 2000));
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Started background command: ${cmd} ${cmdArgs.join(" ")}\nThe server should be starting up.`,
                },
              ],
            };
          }
          
          // For regular commands, run with timeout
          const result = await ctx.sandbox.runCommand({
            cmd,
            args: cmdArgs,
            cwd: cwd ?? "/vercel/sandbox",
          });
          
          // Wait for completion with timeout
          const stdoutPromise = result.stdout();
          const stderrPromise = result.stderr();
          
          const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`Command timed out after ${timeout}ms`)), timeout)
          );
          
          const [stdout, stderr] = await Promise.race([
            Promise.all([stdoutPromise, stderrPromise]),
            timeoutPromise.then(() => { throw new Error("timeout"); }),
          ]) as [string, string];
          
          return {
            content: [
              {
                type: "text" as const,
                text: `Exit code: ${result.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
              },
            ],
            isError: result.exitCode !== 0,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error running command: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    },
    {
      name: "list_files",
      description: "List files in the sandbox",
      inputSchema: {
        path: z.string().optional().describe("Directory path to list"),
        recursive: z.boolean().optional().describe("List recursively"),
      },
      handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const path = args.path as string | undefined;
        const recursive = args.recursive as boolean | undefined;
        try {
          const targetPath = path ?? "/vercel/sandbox";
          const cmdArgs = recursive
            ? [targetPath, "-type", "f", "-not", "-path", "*/node_modules/*"]
            : ["-la", targetPath];
          const cmd = recursive ? "find" : "ls";
          const result = await ctx.sandbox.runCommand({ cmd, args: cmdArgs });
          const stdout = await result.stdout();
          return { content: [{ type: "text" as const, text: stdout }] };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error listing files: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    },
    {
      name: "get_preview_url",
      description: "Get the public URL for a port exposed by the sandbox",
      inputSchema: {
        port: z.number().describe("Port number (e.g., 3000, 5173)"),
      },
      handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const port = args.port as number;
        try {
          // sandbox.domain() returns the full URL as a string
          const url = ctx.sandbox.domain(port);
          return { content: [{ type: "text" as const, text: `Preview URL: ${url}` }] };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Port ${port} is not exposed or sandbox domain unavailable`,
              },
            ],
            isError: true,
          };
        }
      },
    },
  ];
}

// ============================================================================
// Claude Agent Provider
// ============================================================================

export class ClaudeAgentProvider implements AgentProvider {
  id = "claude-agent";
  name = "Claude Agent";
  description = "Claude Code SDK with full agent capabilities";
  
  // Track pending tool calls to match results with tool names
  private pendingToolCalls = new Map<string, { name: string; input: unknown }>();

  /**
   * Execute a prompt using the Claude Agent SDK.
   * Yields StreamChunk objects for streaming to the client.
   */
  async *execute(params: ExecuteParams): AsyncIterable<StreamChunk> {
    const { prompt, sandboxContext, signal, sessionId } = params;

    // Create MCP server with sandbox tools
    const sandboxMcp = createSdkMcpServer({
      name: "sandbox",
      tools: createSandboxTools(sandboxContext),
    });

    // Create abort controller linked to the signal
    const abortController = new AbortController();
    if (signal) {
      signal.addEventListener("abort", () => abortController.abort());
    }

    try {
      // Query the Claude Agent SDK
      const queryResult = query({
        prompt,
        options: {
          tools: [], // Disable built-in tools, we provide our own via MCP
          mcpServers: { sandbox: sandboxMcp },
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          abortController,
          systemPrompt: SYSTEM_PROMPT,
          includePartialMessages: true, // Get streaming events
          persistSession: true, // Enable session persistence for conversation memory
          ...(sessionId && { resume: sessionId }), // Resume if session ID provided
        },
      });

      // Iterate over SDK messages and convert to StreamChunks
      for await (const sdkMessage of queryResult) {
        for (const chunk of this.convertToStreamChunks(sdkMessage)) {
          yield chunk;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // Graceful abort, don't yield error
        return;
      }
      yield {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        code: this.classifyError(error),
      };
    }
  }

  // ============================================================================
  // Private: SDK Message → StreamChunk Conversion
  // ============================================================================

  /**
   * Converts a Claude Agent SDK message to StreamChunk(s).
   * This is the internal conversion layer - the public interface only sees StreamChunk.
   */
  private *convertToStreamChunks(sdkMessage: SDKMessage): Generator<StreamChunk> {
    switch (sdkMessage.type) {
      case "assistant":
        for (const chunk of this.convertAssistantMessage(sdkMessage)) {
          yield chunk;
        }
        break;

      case "stream_event":
        for (const chunk of this.convertStreamEvent(sdkMessage)) {
          yield chunk;
        }
        break;

      case "result":
        for (const chunk of this.convertResultMessage(sdkMessage)) {
          yield chunk;
        }
        break;

      case "system":
        // System messages (init, status) - emit session info and status
        if (sdkMessage.subtype === "init") {
          // Emit message-start with session ID for the client to track
          yield {
            type: "message-start",
            id: sdkMessage.uuid,
            role: "assistant" as const,
            sessionId: sdkMessage.session_id,
          };
          yield {
            type: "data",
            dataType: "agent-status",
            data: { status: "thinking", message: "Agent initialized" },
          };
        }
        break;

      case "user":
        // User messages contain tool results
        for (const chunk of this.convertUserMessage(sdkMessage)) {
          yield chunk;
        }
        break;

      case "tool_progress":
        // Tool is running - emit status update
        yield {
          type: "data",
          dataType: "agent-status",
          data: {
            status: "tool-use",
            message: `Running ${(sdkMessage as { tool_name?: string }).tool_name ?? "tool"}...`,
          },
        };
        break;

      default:
        // Other message types (status, hook, etc.) are handled internally by SDK
        break;
    }
  }

  /**
   * Convert user message which may contain tool results.
   */
  private *convertUserMessage(
    sdkMessage: { type: "user"; message?: { content?: unknown }; tool_use_result?: unknown }
  ): Generator<StreamChunk> {
    // Check for tool_use_result directly on the message
    if (sdkMessage.tool_use_result) {
      const result = sdkMessage.tool_use_result as {
        tool_use_id?: string;
        content?: string | Array<{ type: string; text?: string }>;
        is_error?: boolean;
      };
      
      if (result.tool_use_id) {
        let output = "";
        if (typeof result.content === "string") {
          output = result.content;
        } else if (Array.isArray(result.content)) {
          output = result.content
            .filter((c) => c.type === "text" && c.text)
            .map((c) => c.text)
            .join("\n");
        }

        yield {
          type: "tool-result",
          toolCallId: result.tool_use_id,
          output,
          isError: result.is_error,
        };
        
        // Emit data parts based on which tool completed
        for (const chunk of this.emitToolDataParts(result.tool_use_id, output)) {
          yield chunk;
        }
      }
    }

    // Also check message.content for tool_result blocks
    const content = sdkMessage.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "tool_result"
        ) {
          const toolResult = block as {
            type: "tool_result";
            tool_use_id: string;
            content?: string | Array<{ type: string; text?: string }>;
            is_error?: boolean;
          };

          let output = "";
          if (typeof toolResult.content === "string") {
            output = toolResult.content;
          } else if (Array.isArray(toolResult.content)) {
            output = toolResult.content
              .filter((c) => c.type === "text" && c.text)
              .map((c) => c.text)
              .join("\n");
          }

          yield {
            type: "tool-result",
            toolCallId: toolResult.tool_use_id,
            output,
            isError: toolResult.is_error,
          };
          
          // Emit data parts based on which tool completed
          for (const chunk of this.emitToolDataParts(toolResult.tool_use_id, output)) {
            yield chunk;
          }
        }
      }
    }
  }

  /**
   * Convert assistant message with complete content blocks.
   * 
   * NOTE: When includePartialMessages is true (which we use), the SDK sends both:
   * 1. stream_event messages with content_block_delta (real-time streaming)
   * 2. assistant messages with the complete assembled content
   * 
   * We should NOT re-emit text from assistant messages since we already emitted
   * it via stream_event deltas. However, we still need to process tool_use blocks
   * that might appear in assistant messages for non-streaming scenarios.
   */
  private *convertAssistantMessage(
    sdkMessage: SDKAssistantMessage
  ): Generator<StreamChunk> {
    // Skip assistant messages entirely when streaming is enabled.
    // The content was already emitted via stream_event deltas.
    // This prevents duplicate output.
    return;
  }

  /**
   * Convert streaming events for real-time updates.
   */
  private *convertStreamEvent(
    sdkMessage: SDKPartialAssistantMessage
  ): Generator<StreamChunk> {
    const event = sdkMessage.event;
    if (!event) return;

    switch (event.type) {
      case "content_block_start":
        for (const chunk of this.handleContentBlockStart(event)) {
          yield chunk;
        }
        break;

      case "content_block_delta":
        for (const chunk of this.handleContentBlockDelta(event)) {
          yield chunk;
        }
        break;

      case "content_block_stop":
        // Block finished - no action needed
        break;

      // Message-level events
      case "message_start":
      case "message_delta":
      case "message_stop":
        // Handled at higher level
        break;
    }
  }

  /**
   * Handle the start of a content block (text or tool_use).
   */
  private *handleContentBlockStart(
    event: { type: "content_block_start"; content_block: { type: string; id?: string; name?: string } }
  ): Generator<StreamChunk> {
    const block = event.content_block;
    if (block.type === "tool_use" && block.id && block.name) {
      // Track this tool call so we can emit data parts when it completes
      this.pendingToolCalls.set(block.id, { name: block.name, input: {} });
      
      yield {
        type: "tool-start",
        toolCallId: block.id,
        toolName: block.name,
      };
    }
    // Text blocks don't need a "start" event - we just accumulate deltas
  }

  /**
   * Handle content block deltas (streaming text or tool input).
   */
  private *handleContentBlockDelta(
    event: { type: "content_block_delta"; index: number; delta: { type: string; text?: string; thinking?: string; partial_json?: string } }
  ): Generator<StreamChunk> {
    const delta = event.delta;
    if (delta.type === "text_delta" && delta.text) {
      yield { type: "text-delta", text: delta.text };
    } else if (delta.type === "thinking_delta" && delta.thinking) {
      yield { type: "reasoning-delta", text: delta.thinking };
    } else if (delta.type === "input_json_delta" && delta.partial_json) {
      // This is tool input streaming - we track by block index
      yield {
        type: "tool-input-delta",
        toolCallId: `block-${event.index}`,
        input: delta.partial_json,
      };
    }
  }

  /**
   * Convert a complete content block to StreamChunk(s).
   */
  private *convertContentBlock(
    block: { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }
  ): Generator<StreamChunk> {
    switch (block.type) {
      case "text":
        if (block.text) {
          yield { type: "text-delta", text: block.text };
        }
        break;

      case "thinking":
        if (block.thinking) {
          yield { type: "reasoning-delta", text: block.thinking };
        }
        break;

      case "tool_use":
        if (block.id && block.name) {
          yield {
            type: "tool-start",
            toolCallId: block.id,
            toolName: block.name,
          };
          yield {
            type: "tool-input-delta",
            toolCallId: block.id,
            input: JSON.stringify(block.input, null, 2),
          };
        }
        break;

      // Note: tool_result blocks come in user messages, not assistant messages
      // The SDK handles tool execution internally
    }
  }

  /**
   * Convert result message (success or error).
   */
  private *convertResultMessage(
    sdkMessage: SDKResultMessage
  ): Generator<StreamChunk> {
    if (sdkMessage.subtype === "success") {
      yield {
        type: "message-end",
        usage: {
          inputTokens: sdkMessage.usage.input_tokens,
          outputTokens: sdkMessage.usage.output_tokens,
        },
      };
    } else {
      // Error result
      const errorTypes: Record<string, string> = {
        error_during_execution: "Agent execution error",
        error_max_turns: "Maximum turns exceeded",
        error_max_budget_usd: "Budget exceeded",
        error_max_structured_output_retries: "Output validation failed",
      };
      const errorMessage =
        errorTypes[sdkMessage.subtype] || "Unknown error";
      yield {
        type: "error",
        message: sdkMessage.errors?.join(", ") || errorMessage,
        code: sdkMessage.subtype,
      };
      yield {
        type: "message-end",
        usage: {
          inputTokens: sdkMessage.usage.input_tokens,
          outputTokens: sdkMessage.usage.output_tokens,
        },
      };
    }
  }

  /**
   * Emit data parts based on which tool completed.
   * This updates the UI (file list, terminal, preview) based on tool results.
   */
  private *emitToolDataParts(toolUseId: string, output: string): Generator<StreamChunk> {
    const toolCall = this.pendingToolCalls.get(toolUseId);
    if (!toolCall) return;
    
    const toolName = toolCall.name;
    this.pendingToolCalls.delete(toolUseId);
    
    // Handle write_file - emit file-written data part
    if (toolName.includes("write_file")) {
      // Parse the path from output like "Wrote 123 bytes to /vercel/sandbox/foo.js"
      const match = output.match(/to\s+(\/vercel\/sandbox\/[^\s]+)/);
      if (match) {
        yield {
          type: "data",
          dataType: "file-written",
          data: { path: match[1] },
        };
      }
    }
    
    // Handle run_command - emit command-output data part
    if (toolName.includes("run_command")) {
      // Parse stdout/stderr from output
      const stdoutMatch = output.match(/stdout:\n([\s\S]*?)(?=\nstderr:|$)/);
      const stderrMatch = output.match(/stderr:\n([\s\S]*?)$/);
      const exitCodeMatch = output.match(/Exit code: (\d+)/);
      
      const stdout = stdoutMatch?.[1]?.trim() || "";
      const stderr = stderrMatch?.[1]?.trim() || "";
      const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : undefined;
      
      if (stdout) {
        yield {
          type: "data",
          dataType: "command-output",
          data: { 
            command: "command", // We don't have the original command here
            output: stdout,
            stream: "stdout" as const,
            exitCode,
          },
        };
      }
      if (stderr) {
        yield {
          type: "data",
          dataType: "command-output",
          data: { 
            command: "command",
            output: stderr,
            stream: "stderr" as const,
            exitCode,
          },
        };
      }
    }
    
    // Handle get_preview_url - emit preview-url data part
    if (toolName.includes("get_preview_url")) {
      // Parse URL from output like "Preview URL: https://..."
      const match = output.match(/Preview URL:\s*(https?:\/\/[^\s]+)/);
      if (match) {
        yield {
          type: "data",
          dataType: "preview-url",
          data: { url: match[1], port: 3000 }, // Default to 3000
        };
      }
    }
  }

  /**
   * Classify an error for client handling.
   */
  private classifyError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("rate limit")) return "rate_limit";
    if (message.includes("auth") || message.includes("401")) return "auth";
    if (message.includes("abort")) return "aborted";
    return "unknown";
  }
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const claudeAgent = new ClaudeAgentProvider();
