/**
 * Claude Agent Provider
 *
 * Implements the AgentProvider interface using the Claude Agent SDK.
 * Uses Claude Code-compatible tool signatures that operate on the Vercel Sandbox.
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
// System Prompt - Append sandbox-specific instructions to Claude Code default
// ============================================================================

const SANDBOX_INSTRUCTIONS = `
SANDBOX ENVIRONMENT:
- You are in a Vercel Sandbox at /vercel/sandbox
- Next.js 15, React 19, Tailwind CSS, TypeScript are pre-installed
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
// Claude Code Compatible Tool Definitions
// ============================================================================

/**
 * Creates Claude Code-compatible tools that operate on the Vercel Sandbox.
 * Tool signatures match the built-in Claude Code tools (Read, Edit, Write, Bash, Glob, Grep).
 */
function createSandboxTools(ctx: SandboxContext) {
  return [
    // ========================================================================
    // Read - File reading with offset/limit support
    // ========================================================================
    {
      name: "Read",
      description:
        "Read a file from the filesystem. Supports reading specific line ranges with offset/limit.",
      inputSchema: {
        file_path: z.string().describe("The absolute path to the file to read"),
        offset: z
          .number()
          .optional()
          .describe("The line number to start reading from (0-based)"),
        limit: z
          .number()
          .optional()
          .describe("The number of lines to read"),
      },
      handler: async (
        args: Record<string, unknown>
      ): Promise<CallToolResult> => {
        const filePath = args.file_path as string;
        const offset = args.offset as number | undefined;
        const limit = args.limit as number | undefined;

        // Ensure path is within sandbox
        const fullPath = filePath.startsWith("/vercel/sandbox")
          ? filePath
          : `/vercel/sandbox/${filePath.replace(/^\/+/, "")}`;

        try {
          const stream = await ctx.sandbox.readFile({ path: fullPath });
          if (!stream) {
            return {
              content: [
                { type: "text" as const, text: `Error: File not found: ${fullPath}` },
              ],
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

          let content = new TextDecoder().decode(
            chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
          );

          // Apply offset/limit if specified
          if (offset !== undefined || limit !== undefined) {
            const lines = content.split("\n");
            const startLine = offset ?? 0;
            const endLine = limit ? startLine + limit : lines.length;
            const selectedLines = lines.slice(startLine, endLine);
            // Format with line numbers like cat -n
            content = selectedLines
              .map((line, i) => `${String(startLine + i + 1).padStart(6, " ")}\t${line}`)
              .join("\n");
          }

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

    // ========================================================================
    // Edit - String replacement editing
    // ========================================================================
    {
      name: "Edit",
      description:
        "Edit a file by replacing a specific string with another string. The old_string must match exactly.",
      inputSchema: {
        file_path: z.string().describe("The absolute path to the file to modify"),
        old_string: z.string().describe("The text to replace"),
        new_string: z
          .string()
          .describe("The text to replace it with (must be different from old_string)"),
        replace_all: z
          .boolean()
          .optional()
          .describe("Replace all occurrences of old_string (default false)"),
      },
      handler: async (
        args: Record<string, unknown>
      ): Promise<CallToolResult> => {
        const filePath = args.file_path as string;
        const oldString = args.old_string as string;
        const newString = args.new_string as string;
        const replaceAll = args.replace_all as boolean | undefined;

        const fullPath = filePath.startsWith("/vercel/sandbox")
          ? filePath
          : `/vercel/sandbox/${filePath.replace(/^\/+/, "")}`;

        try {
          // Read the file first
          const stream = await ctx.sandbox.readFile({ path: fullPath });
          if (!stream) {
            return {
              content: [
                { type: "text" as const, text: `Error: File not found: ${fullPath}` },
              ],
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

          let content = new TextDecoder().decode(
            chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
          );

          // Check if old_string exists
          if (!content.includes(oldString)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: old_string not found in file content`,
                },
              ],
              isError: true,
            };
          }

          // Check for multiple matches when not using replace_all
          if (!replaceAll) {
            const matches = content.split(oldString).length - 1;
            if (matches > 1) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Error: old_string found ${matches} times. Use replace_all=true or provide more context to make it unique.`,
                  },
                ],
                isError: true,
              };
            }
          }

          // Perform the replacement
          const newContent = replaceAll
            ? content.split(oldString).join(newString)
            : content.replace(oldString, newString);

          // Write the file back
          await ctx.sandbox.writeFiles([
            { path: fullPath, content: Buffer.from(newContent, "utf-8") },
          ]);

          return {
            content: [
              {
                type: "text" as const,
                text: `Successfully edited ${fullPath}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error editing file: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    },

    // ========================================================================
    // Write - Write full file content
    // ========================================================================
    {
      name: "Write",
      description: "Write content to a file, creating it if it doesn't exist or overwriting if it does.",
      inputSchema: {
        file_path: z
          .string()
          .describe("The absolute path to the file to write (must be absolute, not relative)"),
        content: z.string().describe("The content to write to the file"),
      },
      handler: async (
        args: Record<string, unknown>
      ): Promise<CallToolResult> => {
        const filePath = args.file_path as string;
        const content = args.content as string;

        const fullPath = filePath.startsWith("/vercel/sandbox")
          ? filePath
          : `/vercel/sandbox/${filePath.replace(/^\/+/, "")}`;

        try {
          await ctx.sandbox.writeFiles([
            { path: fullPath, content: Buffer.from(content, "utf-8") },
          ]);
          return {
            content: [
              {
                type: "text" as const,
                text: `Wrote ${content.length} bytes to ${fullPath}`,
              },
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

    // ========================================================================
    // Bash - Command execution
    // ========================================================================
    {
      name: "Bash",
      description:
        "Execute a shell command in the sandbox. Long-running commands like dev servers run in the background.",
      inputSchema: {
        command: z.string().describe("The command to execute"),
        timeout: z
          .number()
          .optional()
          .describe("Optional timeout in milliseconds (max 600000). Default 30000."),
        description: z
          .string()
          .optional()
          .describe("Clear, concise description of what this command does"),
      },
      handler: async (
        args: Record<string, unknown>
      ): Promise<CallToolResult> => {
        const command = args.command as string;
        const timeout = (args.timeout as number | undefined) ?? 30000;

        // Build environment variables for the command
        // Include proxy config so any code in the sandbox can call Anthropic API through our proxy
        const env: Record<string, string> = {};
        if (ctx.proxySessionId && ctx.proxyBaseUrl) {
          env.ANTHROPIC_BASE_URL = ctx.proxyBaseUrl;
          env.ANTHROPIC_API_KEY = ctx.proxySessionId;
          env.ANTHROPIC_AUTH_TOKEN = ctx.proxySessionId;
        }

        try {
          // Detect if this is a dev server command that should run in background
          const isDevServer =
            command.includes("npm run dev") ||
            command.includes("npm start") ||
            command.includes("yarn dev") ||
            command.includes("pnpm dev") ||
            command.includes("vite") ||
            command.includes("next dev");

          // Detect if this is an npm/pnpm install command
          const isInstall =
            command.includes("npm install") ||
            command.includes("npm i") ||
            command.includes("pnpm install") ||
            command.includes("pnpm i") ||
            command.includes("yarn install") ||
            command.includes("yarn add");

          if (isDevServer) {
            // For dev servers, start and don't wait - let it run in background
            ctx.sandbox.runCommand({
              cmd: "sh",
              args: ["-c", command],
              cwd: "/vercel/sandbox",
              env,
            });
            await new Promise((resolve) => setTimeout(resolve, 3000));
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Started background command: ${command}\nThe server should be starting up. Check port 3000 or 5173 for the preview.`,
                },
              ],
            };
          }

          // For regular commands, run and wait for completion
          const result = await ctx.sandbox.runCommand({
            cmd: "sh",
            args: ["-c", command],
            cwd: "/vercel/sandbox",
            env,
          });

          // Wait for completion with timeout
          const stdoutPromise = result.stdout();
          const stderrPromise = result.stderr();

          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Command timed out after ${timeout}ms`)),
              timeout
            )
          );

          const [stdout, stderr] = (await Promise.race([
            Promise.all([stdoutPromise, stderrPromise]),
            timeoutPromise.then(() => {
              throw new Error("timeout");
            }),
          ])) as [string, string];

          let output = [
            stdout ? `stdout:\n${stdout}` : "",
            stderr ? `stderr:\n${stderr}` : "",
            `Exit code: ${result.exitCode}`,
          ]
            .filter(Boolean)
            .join("\n\n");

          // Auto-start dev server after successful npm/pnpm install
          if (isInstall && result.exitCode === 0) {
            // Check if package.json has a dev script
            try {
              const pkgJson = await ctx.sandbox.readFileToBuffer({
                path: "/vercel/sandbox/package.json",
              });
              if (pkgJson) {
                const pkg = JSON.parse(pkgJson.toString());
                if (pkg.scripts?.dev) {
                  // Start dev server automatically
                  ctx.sandbox.runCommand({
                    cmd: "sh",
                    args: ["-c", "npm run dev"],
                    cwd: "/vercel/sandbox",
                    env,
                    detached: true,
                  });
                  // Wait for it to start
                  await new Promise((resolve) => setTimeout(resolve, 3000));
                  output += "\n\n✓ Dev server started automatically on port 3000. Preview is ready!";
                }
              }
            } catch {
              // Ignore errors - dev server auto-start is best effort
            }
          }

          return {
            content: [{ type: "text" as const, text: output }],
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

    // ========================================================================
    // Glob - File pattern matching
    // ========================================================================
    {
      name: "Glob",
      description:
        "Find files matching a glob pattern. Returns matching file paths sorted by modification time.",
      inputSchema: {
        pattern: z.string().describe("The glob pattern to match files against"),
        path: z
          .string()
          .optional()
          .describe(
            "The directory to search in. Defaults to /vercel/sandbox."
          ),
      },
      handler: async (
        args: Record<string, unknown>
      ): Promise<CallToolResult> => {
        const pattern = args.pattern as string;
        const searchPath = (args.path as string | undefined) ?? "/vercel/sandbox";

        const fullPath = searchPath.startsWith("/vercel/sandbox")
          ? searchPath
          : `/vercel/sandbox/${searchPath.replace(/^\/+/, "")}`;

        try {
          // Use find with -name for glob patterns
          const result = await ctx.sandbox.runCommand({
            cmd: "find",
            args: [
              fullPath,
              "-type",
              "f",
              "-name",
              pattern,
              "-not",
              "-path",
              "*/node_modules/*",
              "-not",
              "-path",
              "*/.git/*",
            ],
            cwd: "/vercel/sandbox",
          });

          const stdout = await result.stdout();
          const files = stdout.trim().split("\n").filter(Boolean);

          if (files.length === 0) {
            return {
              content: [
                { type: "text" as const, text: `No files found matching pattern: ${pattern}` },
              ],
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `Found ${files.length} files:\n${files.join("\n")}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error searching files: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    },

    // ========================================================================
    // Grep - Content search
    // ========================================================================
    {
      name: "Grep",
      description:
        "Search file contents using a regular expression pattern. Returns matching files and line numbers.",
      inputSchema: {
        pattern: z
          .string()
          .describe("The regular expression pattern to search for"),
        path: z
          .string()
          .optional()
          .describe("File or directory to search in. Defaults to /vercel/sandbox."),
        glob: z
          .string()
          .optional()
          .describe('Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")'),
      },
      handler: async (
        args: Record<string, unknown>
      ): Promise<CallToolResult> => {
        const pattern = args.pattern as string;
        const searchPath = (args.path as string | undefined) ?? "/vercel/sandbox";
        const glob = args.glob as string | undefined;

        const fullPath = searchPath.startsWith("/vercel/sandbox")
          ? searchPath
          : `/vercel/sandbox/${searchPath.replace(/^\/+/, "")}`;

        try {
          // Use grep -r for recursive search
          const grepArgs = [
            "-r",
            "-n", // line numbers
            "-E", // extended regex
            "--include",
            glob ?? "*",
            pattern,
            fullPath,
          ];

          // Exclude common directories
          grepArgs.push("--exclude-dir=node_modules", "--exclude-dir=.git");

          const result = await ctx.sandbox.runCommand({
            cmd: "grep",
            args: grepArgs,
            cwd: "/vercel/sandbox",
          });

          const stdout = await result.stdout();
          const stderr = await result.stderr();

          if (result.exitCode === 1) {
            // No matches found (grep returns 1 for no matches)
            return {
              content: [
                { type: "text" as const, text: `No matches found for pattern: ${pattern}` },
              ],
            };
          }

          if (result.exitCode !== 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Grep error: ${stderr || "Unknown error"}`,
                },
              ],
              isError: true,
            };
          }

          const lines = stdout.trim().split("\n").filter(Boolean);
          return {
            content: [
              {
                type: "text" as const,
                text: `Found ${lines.length} matches:\n${stdout}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error searching: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    },

    // ========================================================================
    // LS - List directory contents (bonus tool for sandbox)
    // ========================================================================
    {
      name: "LS",
      description: "List directory contents with file details.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Directory path to list. Defaults to /vercel/sandbox."),
      },
      handler: async (
        args: Record<string, unknown>
      ): Promise<CallToolResult> => {
        const dirPath = (args.path as string | undefined) ?? "/vercel/sandbox";

        const fullPath = dirPath.startsWith("/vercel/sandbox")
          ? dirPath
          : `/vercel/sandbox/${dirPath.replace(/^\/+/, "")}`;

        try {
          const result = await ctx.sandbox.runCommand({
            cmd: "ls",
            args: ["-la", fullPath],
            cwd: "/vercel/sandbox",
          });

          const stdout = await result.stdout();
          return { content: [{ type: "text" as const, text: stdout }] };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error listing directory: ${error instanceof Error ? error.message : String(error)}`,
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
    const { prompt, sandboxContext, signal, sessionId, model } = params;

    // Create MCP server with Claude Code-compatible sandbox tools
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
      // Build explicit env to avoid inheriting shell environment variables (like ANTHROPIC_API_KEY from .zshrc)
      // Configure for Vercel AI Gateway authentication
      const sdkEnv: Record<string, string | undefined> = {
        // Vercel AI Gateway configuration
        ANTHROPIC_BASE_URL: "https://ai-gateway.vercel.sh",
        ANTHROPIC_AUTH_TOKEN: process.env.VERCEL_OIDC_TOKEN,
        ANTHROPIC_API_KEY: "", // Empty string required - prevents SDK from using shell env
        // Minimal system env for subprocess execution
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
      };

      // Query the Claude Agent SDK with Claude Code system prompt + sandbox additions
      const queryResult = query({
        prompt,
        options: {
          // Explicit env to avoid inheriting shell variables like ANTHROPIC_API_KEY from .zshrc
          env: sdkEnv,
          // Enable only the Task tool from built-in tools (for subagent spawning)
          // All other tools (Read, Write, Edit, Bash, Glob, Grep, LS) are provided via MCP
          tools: ["Task"],
          // Auto-allow all our MCP tools and the Task tool without permission prompts
          allowedTools: ["Task", "mcp__sandbox__Read", "mcp__sandbox__Write", "mcp__sandbox__Edit", "mcp__sandbox__Bash", "mcp__sandbox__Glob", "mcp__sandbox__Grep", "mcp__sandbox__LS"],
          mcpServers: { sandbox: sandboxMcp },
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          abortController,
          // Use Claude Code's default system prompt with sandbox-specific additions
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: SANDBOX_INSTRUCTIONS,
          },
          // Define subagents that can be spawned via the Task tool
          agents: {
            general: {
              description:
                "General-purpose agent for researching and executing multi-step tasks",
              prompt:
                "You are a helpful coding assistant working in a Vercel Sandbox. Complete the task thoroughly using the sandbox tools.",
              model: "inherit",
            },
            explore: {
              description:
                "Fast agent for exploring codebases - finding files, searching code",
              prompt:
                "You are a fast code exploration assistant working in a Vercel Sandbox. Use Glob and Grep to find relevant files and code patterns. Be thorough but efficient.",
              model: "haiku",
            },
          },
          includePartialMessages: true,
          persistSession: true,
          ...(sessionId && { resume: sessionId }),
          ...(model && { model }),
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
        if (sdkMessage.subtype === "init") {
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
        for (const chunk of this.convertUserMessage(sdkMessage)) {
          yield chunk;
        }
        break;

      case "tool_progress":
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
        break;
    }
  }

  private *convertUserMessage(
    sdkMessage: {
      type: "user";
      message?: { content?: unknown };
      tool_use_result?: unknown;
    }
  ): Generator<StreamChunk> {
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

        for (const chunk of this.emitToolDataParts(result.tool_use_id, output)) {
          yield chunk;
        }
      }
    }

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

          for (const chunk of this.emitToolDataParts(
            toolResult.tool_use_id,
            output
          )) {
            yield chunk;
          }
        }
      }
    }
  }

  private *convertAssistantMessage(
    _sdkMessage: SDKAssistantMessage
  ): Generator<StreamChunk> {
    // Skip - content already emitted via stream_event deltas
    return;
  }

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
        break;

      case "message_start":
      case "message_delta":
      case "message_stop":
        break;
    }
  }

  private *handleContentBlockStart(event: {
    type: "content_block_start";
    content_block: { type: string; id?: string; name?: string };
  }): Generator<StreamChunk> {
    const block = event.content_block;
    if (block.type === "tool_use" && block.id && block.name) {
      this.pendingToolCalls.set(block.id, { name: block.name, input: {} });

      yield {
        type: "tool-start",
        toolCallId: block.id,
        toolName: block.name,
      };
    }
  }

  private *handleContentBlockDelta(event: {
    type: "content_block_delta";
    index: number;
    delta: {
      type: string;
      text?: string;
      thinking?: string;
      partial_json?: string;
    };
  }): Generator<StreamChunk> {
    const delta = event.delta;
    if (delta.type === "text_delta" && delta.text) {
      yield { type: "text-delta", text: delta.text };
    } else if (delta.type === "thinking_delta" && delta.thinking) {
      yield { type: "reasoning-delta", text: delta.thinking };
    } else if (delta.type === "input_json_delta" && delta.partial_json) {
      yield {
        type: "tool-input-delta",
        toolCallId: `block-${event.index}`,
        input: delta.partial_json,
      };
    }
  }

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
      const errorTypes: Record<string, string> = {
        error_during_execution: "Agent execution error",
        error_max_turns: "Maximum turns exceeded",
        error_max_budget_usd: "Budget exceeded",
        error_max_structured_output_retries: "Output validation failed",
      };
      const errorMessage = errorTypes[sdkMessage.subtype] || "Unknown error";
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
   * Maps Claude Code tool names to UI updates.
   */
  private *emitToolDataParts(
    toolUseId: string,
    output: string
  ): Generator<StreamChunk> {
    const toolCall = this.pendingToolCalls.get(toolUseId);
    if (!toolCall) return;

    const toolName = toolCall.name;
    this.pendingToolCalls.delete(toolUseId);

    // Handle Write tool - emit file-written data part
    if (toolName === "Write" || toolName.includes("Write")) {
      const match = output.match(/to\s+(\/vercel\/sandbox\/[^\s]+)/);
      if (match) {
        yield {
          type: "data",
          dataType: "file-written",
          data: { path: match[1] },
        };
      }
    }

    // Handle Bash tool - emit command-output data part
    if (toolName === "Bash" || toolName.includes("Bash")) {
      const stdoutMatch = output.match(/stdout:\n([\s\S]*?)(?=\n\nstderr:|$)/);
      const stderrMatch = output.match(/stderr:\n([\s\S]*?)(?=\n\nExit|$)/);
      const exitCodeMatch = output.match(/Exit code: (\d+)/);

      const stdout = stdoutMatch?.[1]?.trim() || "";
      const stderr = stderrMatch?.[1]?.trim() || "";
      const exitCode = exitCodeMatch
        ? parseInt(exitCodeMatch[1], 10)
        : undefined;

      if (stdout) {
        yield {
          type: "data",
          dataType: "command-output",
          data: {
            command: "bash",
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
            command: "bash",
            output: stderr,
            stream: "stderr" as const,
            exitCode,
          },
        };
      }
    }
  }

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
