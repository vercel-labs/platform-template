# Platforms Template - AI Code Generation & Deployment

A multi-project platform where users generate code with AI agents and deploy to Vercel with one click.

## Overview

This template demonstrates building a "vibe coding" platform using:
- **AI Agents** (Claude Agent SDK, OpenAI Codex, OpenCode) running in sandboxes
- **Vercel Sandbox** for isolated code execution
- **Vercel SDK** for deploying generated code to production

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Platforms Template                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌───────────────────────────────────────────────────┐  │
│  │   Chat UI    │    │              Agent Registry                        │  │
│  │              │    │  ┌─────────────┬─────────────┬─────────────────┐  │  │
│  │ [Agent: ▼]   │───▶│  │ Claude Agent│ Codex Agent │ OpenCode Agent  │  │  │
│  └──────────────┘    │  │ SDK         │ SDK         │ SDK             │  │  │
│                      │  └──────┬──────┴──────┬──────┴────────┬────────┘  │  │
│                      └─────────┼─────────────┼───────────────┼───────────┘  │
│                                │             │               │              │
│                                └─────────────┼───────────────┘              │
│                                              ▼                              │
│                      ┌───────────────────────────────────────────────────┐  │
│                      │           AI Gateway (VERCEL_OIDC_TOKEN)          │  │
│                      │           https://ai-gateway.vercel.sh            │  │
│                      └───────────────────────────────────────────────────┘  │
│                                              │                              │
│                                              ▼                              │
│                      ┌───────────────────────────────────────────────────┐  │
│                      │              Shared MCP Sandbox Tools             │  │
│                      │  ┌──────────┬──────────┬─────────┬────────────┐   │  │
│                      │  │read_file │write_file│run_cmd  │get_preview │   │  │
│                      │  └──────────┴──────────┴─────────┴────────────┘   │  │
│                      └───────────────────────────────────────────────────┘  │
│                                              │                              │
│                                              ▼                              │
│                      ┌───────────────────────────────────────────────────┐  │
│                      │              @vercel/sandbox                       │  │
│                      │              (Firecracker MicroVM)                 │  │
│                      └───────────────────────────────────────────────────┘  │
│                                              │                              │
│                                              ▼                              │
│                      ┌───────────────────────────────────────────────────┐  │
│                      │              Deploy to Vercel                      │  │
│                      │              @vercel/sdk deployFiles()            │  │
│                      └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Decisions

| Decision | Choice |
|----------|--------|
| **Agent Interface** | Unified `AgentProvider` interface - all agents are equal implementations |
| **Default Agent** | Claude Agent SDK (user can switch to any other) |
| **LLM Routing** | AI Gateway via `VERCEL_OIDC_TOKEN` |
| **Tools** | Disable built-in tools, provide shared MCP tools for sandbox ops |
| **Auth** | None (ephemeral demo) |
| **Persistence** | Session-based only (sandbox continues until timeout) |
| **Deployment** | `deployFiles()` pattern from vercel-platforms-docs |

## Tech Stack

### Core Dependencies

```bash
# Framework
pnpm add next@16 react@19 react-dom@19

# AI SDKs
pnpm add ai @ai-sdk/react @ai-sdk/gateway
pnpm add @anthropic-ai/claude-agent-sdk

# Vercel SDKs
pnpm add @vercel/sandbox @vercel/sdk

# State & Validation
pnpm add zustand zod
```

### UI Dependencies (installed via shadcn)

These are installed automatically when you add AI Elements components:

```bash
# Auto-installed by shadcn AI Elements
ansi-to-react        # Terminal ANSI colors
shiki                # Syntax highlighting
streamdown           # Markdown streaming
@streamdown/code     # Code blocks
@streamdown/mermaid  # Diagrams
@streamdown/math     # Math rendering
use-stick-to-bottom  # Auto-scroll
lucide-react         # Icons
```

## Environment Variables

```bash
# AI Gateway (routes all LLM calls)
AI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh
VERCEL_OIDC_TOKEN=  # For AI Gateway auth

# For Claude Agent SDK specifically
ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh
ANTHROPIC_AUTH_TOKEN=${VERCEL_OIDC_TOKEN}
ANTHROPIC_API_KEY=  # Empty string required

# Vercel Deployments
VERCEL_TOKEN=
VERCEL_TEAM_ID=
```

---

## Type System (Agent SDK → UI Message Conversion)

We're using actual coding agent harnesses (Claude Code, OpenCode, Codex) running in sandboxes - not just calling models directly. Each agent SDK has its own message format, so we convert to a common format.

### Data Flow & Abstraction Boundary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Agent Provider (Internal)                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │ Claude Agent SDK│    │ Codex SDK       │    │ OpenCode SDK            │  │
│  │ query()         │    │ run()           │    │ execute()               │  │
│  │ SDKMessage      │    │ CodexMessage    │    │ OpenCodeMessage         │  │
│  └────────┬────────┘    └────────┬────────┘    └───────────┬─────────────┘  │
│           │                      │                         │                │
│           │  convertToStreamChunks() - PRIVATE to each provider             │
│           │                      │                         │                │
│           └──────────────────────┼─────────────────────────┘                │
│                                  ▼                                          │
│                         ┌───────────────────┐                               │
│                         │   StreamChunk     │  ← Unified internal format    │
│                         │   (text-delta,    │                               │
│                         │    tool-start,    │                               │
│                         │    tool-result,   │                               │
│                         │    data, etc.)    │                               │
│                         └─────────┬─────────┘                               │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │
════════════════════════════════════╪══════════════════════════════════════════
          AgentProvider.execute() yields StreamChunk (PUBLIC INTERFACE)
════════════════════════════════════╪══════════════════════════════════════════
                                    │
┌───────────────────────────────────┼─────────────────────────────────────────┐
│                           API Route / Client                                 │
│                                   ▼                                          │
│                         ┌───────────────────┐                               │
│                         │ MessageAccumulator│  ← Assembles StreamChunks     │
│                         │ into UIMessage    │     into complete messages    │
│                         └─────────┬─────────┘                               │
│                                   ▼                                          │
│                         ┌───────────────────┐                               │
│                         │   ChatMessage     │  ← UIMessage<Metadata,        │
│                         │   (UIMessage)     │     DataPart, {}>             │
│                         └─────────┬─────────┘                               │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                              AI Elements UI                                    │
│   <Message from={msg.role}>                                                   │
│     {msg.parts.map(part => <MessagePart part={part} />)}                      │
│   </Message>                                                                  │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

1. **Conversion is internal** - Each agent provider handles its own SDK → StreamChunk conversion
2. **Single public interface** - All providers yield `StreamChunk` from `execute()`
3. **No leaky abstractions** - API route and client only see `StreamChunk` and `UIMessage`
4. **Type safety preserved** - StreamChunk → UIMessage conversion is typed

### UI Message Types

```typescript
// lib/types.ts

import type { UIMessage, UIMessagePart } from "ai";

// Custom data parts for streaming agent/sandbox status
export type DataPart = {
  "agent-status": {
    status: "thinking" | "tool-use" | "done" | "error";
    message?: string;
  };
  "sandbox-status": {
    sandboxId?: string;
    status: "creating" | "ready" | "error";
    error?: string;
  };
  "file-written": {
    path: string;
  };
  "command-output": {
    command: string;
    output: string;
    stream: "stdout" | "stderr";
    exitCode?: number;
  };
  "preview-url": {
    url: string;
    port: number;
  };
};

// Message metadata
export type MessageMetadata = {
  agentId?: string;
  model?: string;
  duration?: number;
  cost?: number;
};

// Since we're converting from agent SDKs, we use dynamic tools
// (toolName is a string, not a static type)
export type ChatMessage = UIMessage<MessageMetadata, DataPart, {}>;

// Re-export for convenience
export type { UIMessage, UIMessagePart } from "ai";
export type ChatMessagePart = UIMessagePart<DataPart, {}>;
```

### Conversion Layer

Each agent provider converts its SDK messages to UIMessage format:

```typescript
// lib/agents/message-converter.ts

import type { ChatMessage, ChatMessagePart, DataPart } from "@/lib/types";
import { nanoid } from "nanoid";

// Base interface for streaming chunks to the client
export type StreamChunk =
  | { type: "message-start"; id: string; role: "assistant" }
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; input: string }
  | { type: "tool-result"; toolCallId: string; output: string; isError?: boolean }
  | { type: "data"; dataType: keyof DataPart; data: DataPart[keyof DataPart] }
  | { type: "message-end"; usage?: { input: number; output: number } }
  | { type: "error"; message: string };

// Accumulates stream chunks into a UIMessage
export class MessageAccumulator {
  private message: ChatMessage;
  private currentTextPart: { type: "text"; text: string } | null = null;
  private currentReasoningPart: { type: "reasoning"; text: string } | null = null;
  private toolParts: Map<string, ChatMessagePart> = new Map();

  constructor(id: string, metadata?: ChatMessage["metadata"]) {
    this.message = {
      id,
      role: "assistant",
      parts: [],
      metadata,
    };
  }

  process(chunk: StreamChunk): ChatMessage {
    switch (chunk.type) {
      case "text-delta":
        if (!this.currentTextPart) {
          this.currentTextPart = { type: "text", text: "" };
          this.message.parts.push(this.currentTextPart);
        }
        this.currentTextPart.text += chunk.text;
        break;

      case "reasoning-delta":
        if (!this.currentReasoningPart) {
          this.currentReasoningPart = { type: "reasoning", text: "" };
          this.message.parts.push(this.currentReasoningPart);
        }
        this.currentReasoningPart.text += chunk.text;
        break;

      case "tool-start":
        const toolPart: ChatMessagePart = {
          type: "dynamic-tool",
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          state: "input-streaming",
          input: "",
        };
        this.toolParts.set(chunk.toolCallId, toolPart);
        this.message.parts.push(toolPart);
        // Reset text accumulation after tool
        this.currentTextPart = null;
        break;

      case "tool-input-delta":
        const inputPart = this.toolParts.get(chunk.toolCallId);
        if (inputPart && inputPart.type === "dynamic-tool") {
          inputPart.input += chunk.input;
        }
        break;

      case "tool-result":
        const resultPart = this.toolParts.get(chunk.toolCallId);
        if (resultPart && resultPart.type === "dynamic-tool") {
          resultPart.state = chunk.isError ? "output-error" : "output-available";
          if (chunk.isError) {
            resultPart.errorText = chunk.output;
          } else {
            resultPart.output = chunk.output;
          }
        }
        break;

      case "data":
        this.message.parts.push({
          type: `data-${chunk.dataType}` as any,
          data: chunk.data,
        });
        break;

      case "message-end":
        // Finalize any streaming parts
        if (this.currentTextPart) {
          (this.currentTextPart as any).state = "done";
        }
        break;
    }

    return this.message;
  }

  getMessage(): ChatMessage {
    return this.message;
  }
}
```



### Updated Agent Provider Interface

The agent provider now yields `StreamChunk` which gets converted to UIMessage:

```typescript
// lib/agents/types.ts

import type { Sandbox } from "@vercel/sandbox";
import type { StreamChunk } from "./message-converter";

export interface SandboxContext {
  sandboxId: string;
  sandbox: Sandbox;
}

export interface AgentProvider {
  id: string;
  name: string;
  
  // Yields StreamChunk objects that get converted to UIMessage
  execute(params: {
    prompt: string;
    sandboxContext: SandboxContext;
    signal?: AbortSignal;
  }): AsyncIterable<StreamChunk>;
}
```

### Server-Side: Streaming to Client

```typescript
// app/api/chat/route.ts

import { NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import { getAgent } from "@/lib/agents/registry";
import { MessageAccumulator, type StreamChunk } from "@/lib/agents/message-converter";
import { nanoid } from "nanoid";

export async function POST(req: Request) {
  const { messages, agentId, sandboxId } = await req.json();

  const agent = getAgent(agentId ?? "claude-agent");

  // Get or create sandbox
  const sandbox = sandboxId
    ? await Sandbox.get({ sandboxId })
    : await Sandbox.create({ ports: [3000, 5173], timeout: 600_000 });

  const sandboxContext = { sandboxId: sandbox.sandboxId, sandbox };
  const lastUserMessage = messages.filter((m: any) => m.role === "user").pop();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const messageId = nanoid();

      // Send sandbox info first
      const sandboxChunk: StreamChunk = {
        type: "data",
        dataType: "sandbox-status",
        data: { sandboxId: sandbox.sandboxId, status: "ready" },
      };
      controller.enqueue(encoder.encode(JSON.stringify(sandboxChunk) + "\n"));

      // Start message
      controller.enqueue(
        encoder.encode(JSON.stringify({ type: "message-start", id: messageId, role: "assistant" }) + "\n")
      );

      try {
        // Stream from agent - already yields StreamChunk format
        for await (const chunk of agent.execute({
          prompt: lastUserMessage.content,
          sandboxContext,
        })) {
          controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
        }

        controller.enqueue(encoder.encode(JSON.stringify({ type: "message-end" }) + "\n"));
      } catch (error) {
        controller.enqueue(
          encoder.encode(JSON.stringify({
            type: "error",
            message: error instanceof Error ? error.message : "Unknown error",
          }) + "\n")
        );
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
```

### Client-Side: Accumulating Messages

```typescript
// hooks/use-agent-chat.ts

import { useState, useCallback, useRef } from "react";
import type { ChatMessage } from "@/lib/types";
import { MessageAccumulator, type StreamChunk } from "@/lib/agents/message-converter";
import { useAppStore } from "@/lib/store";

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"ready" | "streaming" | "error">("ready");
  const abortRef = useRef<AbortController | null>(null);
  const { agentId, sandboxId, setSandboxId, setPreviewUrl, addFiles } = useAppStore();

  const sendMessage = useCallback(async (content: string) => {
    // Add user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: content }],
    };
    setMessages((prev) => [...prev, userMessage]);
    setStatus("streaming");

    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          agentId,
          sandboxId,
        }),
        signal: abortRef.current.signal,
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let accumulator: MessageAccumulator | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split("\n").filter(Boolean);
        for (const line of lines) {
          const chunk: StreamChunk = JSON.parse(line);

          // Handle message start
          if (chunk.type === "message-start") {
            accumulator = new MessageAccumulator(chunk.id, { agentId });
            continue;
          }

          // Handle special data parts for app state
          if (chunk.type === "data") {
            if (chunk.dataType === "sandbox-status" && chunk.data.sandboxId) {
              setSandboxId(chunk.data.sandboxId);
            }
            if (chunk.dataType === "preview-url") {
              setPreviewUrl(chunk.data.url);
            }
            if (chunk.dataType === "file-written") {
              addFiles([chunk.data.path]);
            }
          }

          // Accumulate into UIMessage
          if (accumulator) {
            const updatedMessage = accumulator.process(chunk);
            setMessages((prev) => {
              const existing = prev.findIndex((m) => m.id === updatedMessage.id);
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = { ...updatedMessage };
                return updated;
              }
              return [...prev, updatedMessage];
            });
          }
        }
      }

      setStatus("ready");
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setStatus("error");
      }
    }
  }, [messages, agentId, sandboxId, setSandboxId, setPreviewUrl, addFiles]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus("ready");
  }, []);

  return { messages, sendMessage, status, stop };
}
```

---

## Unified Agent Interface

All agent SDKs implement a common interface, making it easy to swap implementations:

### Types

```typescript
// lib/agents/types.ts

import type { Sandbox } from "@vercel/sandbox";

export interface SandboxContext {
  sandboxId: string;
  sandbox: Sandbox;
}

export interface AgentMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done';
  content?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentProvider {
  /**
   * Unique identifier for this agent provider
   */
  id: string;
  
  /**
   * Display name for UI
   */
  name: string;
  
  /**
   * Execute a prompt and stream responses
   */
  execute(params: {
    prompt: string;
    messages: Message[];
    sandboxContext: SandboxContext;
    signal?: AbortSignal;
  }): AsyncIterable<AgentMessage>;
}
```

### Claude Agent SDK Implementation (Default)

The Claude Agent SDK conversion happens **inside** the provider - the interface only exposes `StreamChunk`:

```typescript
// lib/agents/claude-agent.ts

import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentProvider, SandboxContext } from "./types";
import type { StreamChunk } from "./message-converter";

export class ClaudeAgentProvider implements AgentProvider {
  id = "claude-agent";
  name = "Claude Agent";

  async *execute(params: {
    prompt: string;
    sandboxContext: SandboxContext;
    signal?: AbortSignal;
  }): AsyncIterable<StreamChunk> {
    const { prompt, sandboxContext, signal } = params;

    const sandboxMcp = createSdkMcpServer({
      name: "sandbox",
      tools: this.createSandboxTools(sandboxContext),
    });

    const abortController = new AbortController();
    if (signal) {
      signal.addEventListener("abort", () => abortController.abort());
    }

    // Iterate over Claude Agent SDK messages and convert to StreamChunk
    for await (const sdkMessage of query({
      prompt,
      options: {
        tools: [],
        mcpServers: { sandbox: sandboxMcp },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        abortController,
        systemPrompt: SYSTEM_PROMPT,
      },
    })) {
      // Convert SDK message to StreamChunk(s) - conversion is internal
      yield* this.convertToStreamChunks(sdkMessage);
    }
  }

  // Private: Converts Claude Agent SDK messages to our StreamChunk format
  private *convertToStreamChunks(sdkMessage: any): Generator<StreamChunk> {
    if (sdkMessage.type === "assistant" && sdkMessage.message?.content) {
      for (const block of sdkMessage.message.content) {
        if (block.type === "text") {
          yield { type: "text-delta", text: block.text };
        } else if (block.type === "tool_use") {
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
      }
    }

    // Tool results come from the SDK automatically after tool execution
    if (sdkMessage.type === "user" && sdkMessage.message?.content) {
      for (const block of sdkMessage.message.content) {
        if (block.type === "tool_result") {
          yield {
            type: "tool-result",
            toolCallId: block.tool_use_id,
            output: typeof block.content === "string" 
              ? block.content 
              : JSON.stringify(block.content),
            isError: block.is_error,
          };
        }
      }
    }

    if (sdkMessage.type === "result") {
      yield { type: "message-end" };
    }
  }

  private createSandboxTools(ctx: SandboxContext) {
    return [
      tool(
        "read_file",
        "Read a file from the sandbox filesystem",
        { path: z.string().describe("Path within /vercel/sandbox") },
        async ({ path }) => {
          if (!path.startsWith("/vercel/sandbox")) {
            return { content: [{ type: "text", text: "Error: Path must be within /vercel/sandbox" }] };
          }
          const stream = await ctx.sandbox.readFile({ path });
          const chunks: Uint8Array[] = [];
          for await (const chunk of stream) chunks.push(chunk);
          const content = new TextDecoder().decode(Buffer.concat(chunks));
          return { content: [{ type: "text", text: content }] };
        }
      ),
      tool(
        "write_file",
        "Write content to a file in the sandbox",
        {
          path: z.string().describe("Path within /vercel/sandbox"),
          content: z.string().describe("Content to write"),
        },
        async ({ path, content }) => {
          if (!path.startsWith("/vercel/sandbox")) {
            return { content: [{ type: "text", text: "Error: Path must be within /vercel/sandbox" }] };
          }
          await ctx.sandbox.writeFiles([{ path, content: Buffer.from(content, "utf-8") }]);
          
          // Emit file-written data part for UI tracking
          // Note: This would need access to a writer - see alternative below
          
          return { content: [{ type: "text", text: `Wrote ${content.length} bytes to ${path}` }] };
        }
      ),
      tool(
        "run_command",
        "Execute a shell command in the sandbox",
        {
          cmd: z.string().describe("Command to run (e.g., 'npm', 'node')"),
          args: z.array(z.string()).optional().describe("Command arguments"),
          cwd: z.string().optional().describe("Working directory"),
        },
        async ({ cmd, args = [], cwd }) => {
          const result = await ctx.sandbox.runCommand({
            cmd,
            args,
            cwd: cwd ?? "/vercel/sandbox",
          });
          return {
            content: [{
              type: "text",
              text: `Exit code: ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
            }],
          };
        }
      ),
      tool(
        "list_files",
        "List files in the sandbox",
        {
          path: z.string().optional().describe("Directory path"),
          recursive: z.boolean().optional().describe("List recursively"),
        },
        async ({ path, recursive }) => {
          const targetPath = path ?? "/vercel/sandbox";
          const args = recursive ? [targetPath, "-type", "f"] : ["-la", targetPath];
          const cmd = recursive ? "find" : "ls";
          const result = await ctx.sandbox.runCommand({ cmd, args });
          return { content: [{ type: "text", text: result.stdout }] };
        }
      ),
      tool(
        "get_preview_url",
        "Get the public URL for a port exposed by the sandbox",
        { port: z.number().describe("Port number (e.g., 3000)") },
        async ({ port }) => {
          try {
            const url = ctx.sandbox.domain(port);
            return { content: [{ type: "text", text: `Preview URL: ${url}` }] };
          } catch {
            return { content: [{ type: "text", text: `Error: Port ${port} is not exposed` }] };
          }
        }
      ),
    ];
  }
}

const SYSTEM_PROMPT = `You are an AI coding assistant running in a Vercel Sandbox environment.

You have access to these tools:
- read_file: Read files from /vercel/sandbox
- write_file: Write files to /vercel/sandbox
- run_command: Execute shell commands (npm, node, etc.)
- list_files: List files in the sandbox
- get_preview_url: Get the public URL for a running dev server

When asked to build an application:
1. Create the necessary files (package.json, source files, etc.)
2. Install dependencies with 'npm install'
3. Start the dev server (e.g., 'npm run dev')
4. Use get_preview_url to provide the user with a preview link

All file paths must be within /vercel/sandbox.`;
```

### Codex Agent Implementation

Same pattern - SDK-specific conversion is internal to the provider:

```typescript
// lib/agents/codex-agent.ts

import type { AgentProvider, SandboxContext } from "./types";
import type { StreamChunk } from "./message-converter";

export class CodexAgentProvider implements AgentProvider {
  id = "codex";
  name = "OpenAI Codex";

  async *execute(params: {
    prompt: string;
    sandboxContext: SandboxContext;
    signal?: AbortSignal;
  }): AsyncIterable<StreamChunk> {
    // TODO: Implement using @openai/codex-sdk
    // 
    // Pattern:
    // 1. Create Codex client with AI Gateway
    // 2. Configure with MCP tools (same sandbox tools)
    // 3. Iterate over Codex SDK messages
    // 4. Convert internally to StreamChunk via this.convertToStreamChunks()
    //
    // const codex = new Codex({
    //   baseURL: process.env.AI_GATEWAY_BASE_URL,
    //   apiKey: process.env.VERCEL_OIDC_TOKEN,
    // });
    //
    // for await (const sdkMessage of codex.run({ prompt, tools })) {
    //   yield* this.convertToStreamChunks(sdkMessage);
    // }
    
    yield { type: "error", message: "Codex agent not yet implemented" };
  }

  private *convertToStreamChunks(sdkMessage: unknown): Generator<StreamChunk> {
    // TODO: Convert Codex SDK message format to StreamChunk
    // This is internal - external interface only sees StreamChunk
  }
}
```

### OpenCode Agent Implementation

```typescript
// lib/agents/opencode-agent.ts

import type { AgentProvider, SandboxContext } from "./types";
import type { StreamChunk } from "./message-converter";

export class OpenCodeAgentProvider implements AgentProvider {
  id = "opencode";
  name = "OpenCode";

  async *execute(params: {
    prompt: string;
    sandboxContext: SandboxContext;
    signal?: AbortSignal;
  }): AsyncIterable<StreamChunk> {
    // TODO: Implement using @opencode-ai/sdk
    //
    // Pattern:
    // 1. Create OpenCode client with AI Gateway  
    // 2. Configure with MCP tools (same sandbox tools)
    // 3. Iterate over OpenCode SDK messages
    // 4. Convert internally to StreamChunk via this.convertToStreamChunks()
    
    yield { type: "error", message: "OpenCode agent not yet implemented" };
  }

  private *convertToStreamChunks(sdkMessage: unknown): Generator<StreamChunk> {
    // TODO: Convert OpenCode SDK message format to StreamChunk
    // This is internal - external interface only sees StreamChunk
  }
}
```

### Agent Registry

```typescript
// lib/agents/registry.ts

import type { AgentProvider } from "./types";
import { ClaudeAgentProvider } from "./claude-agent";
import { CodexAgentProvider } from "./codex-agent";
import { OpenCodeAgentProvider } from "./opencode-agent";

// All agents implement the same interface - execute() yields StreamChunk
const agents: AgentProvider[] = [
  new ClaudeAgentProvider(),  // Default
  new CodexAgentProvider(),
  new OpenCodeAgentProvider(),
];

export function getAgent(id: string): AgentProvider {
  const agent = agents.find((a) => a.id === id);
  if (!agent) throw new Error(`Unknown agent: ${id}`);
  return agent;
}

export function listAgents() {
  return agents.map((a) => ({ id: a.id, name: a.name }));
}

export function getDefaultAgent(): AgentProvider {
  return agents[0];
}
```

---

## Shared MCP Tools

All agent providers use the same sandbox tools. Each provider adapts the neutral definition to their SDK's format:

### Provider-Agnostic Tool Definitions

```typescript
// lib/agents/tool-definitions.ts

import { z } from "zod";
import type { SandboxContext } from "./types";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodObject<any>;
  execute: (params: any, ctx: SandboxContext) => Promise<{ text: string }>;
}

export const sandboxToolDefinitions: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a file from the sandbox filesystem",
    parameters: z.object({
      path: z.string().describe("Path within /vercel/sandbox"),
    }),
    execute: async ({ path }, ctx) => {
      if (!path.startsWith("/vercel/sandbox")) {
        return { text: "Error: Path must be within /vercel/sandbox" };
      }
      const stream = await ctx.sandbox.readFile({ path });
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      return { text: new TextDecoder().decode(Buffer.concat(chunks)) };
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in the sandbox",
    parameters: z.object({
      path: z.string().describe("Path within /vercel/sandbox"),
      content: z.string().describe("Content to write"),
    }),
    execute: async ({ path, content }, ctx) => {
      if (!path.startsWith("/vercel/sandbox")) {
        return { text: "Error: Path must be within /vercel/sandbox" };
      }
      await ctx.sandbox.writeFiles([{ path, content: Buffer.from(content, "utf-8") }]);
      return { text: `Wrote ${content.length} bytes to ${path}` };
    },
  },
  {
    name: "run_command",
    description: "Execute a shell command in the sandbox",
    parameters: z.object({
      cmd: z.string().describe("Command to run (e.g., 'npm', 'node')"),
      args: z.array(z.string()).optional().describe("Command arguments"),
      cwd: z.string().optional().describe("Working directory"),
    }),
    execute: async ({ cmd, args = [], cwd }, ctx) => {
      const result = await ctx.sandbox.runCommand({
        cmd,
        args,
        cwd: cwd ?? "/vercel/sandbox",
      });
      return {
        text: `Exit code: ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      };
    },
  },
  {
    name: "list_files",
    description: "List files in the sandbox",
    parameters: z.object({
      path: z.string().optional().describe("Directory path"),
      recursive: z.boolean().optional().describe("List recursively"),
    }),
    execute: async ({ path, recursive }, ctx) => {
      const targetPath = path ?? "/vercel/sandbox";
      const args = recursive ? [targetPath, "-type", "f"] : ["-la", targetPath];
      const cmd = recursive ? "find" : "ls";
      const result = await ctx.sandbox.runCommand({ cmd, args });
      return { text: result.stdout };
    },
  },
  {
    name: "get_preview_url",
    description: "Get the public URL for a port exposed by the sandbox",
    parameters: z.object({
      port: z.number().describe("Port number (e.g., 3000)"),
    }),
    execute: async ({ port }, ctx) => {
      try {
        return { text: `Preview URL: ${ctx.sandbox.domain(port)}` };
      } catch {
        return { text: `Error: Port ${port} is not exposed` };
      }
    },
  },
];

// Adapters for each agent SDK

// Claude Agent SDK adapter
import { tool as claudeTool } from "@anthropic-ai/claude-agent-sdk";

export function toClaudeTools(definitions: ToolDefinition[], ctx: SandboxContext) {
  return definitions.map((def) =>
    claudeTool(def.name, def.description, def.parameters.shape, async (params) => ({
      content: [{ type: "text", text: (await def.execute(params, ctx)).text }],
    }))
  );
}

// Codex SDK adapter (when implemented)
export function toCodexTools(definitions: ToolDefinition[], ctx: SandboxContext) {
  // TODO: Adapt to Codex SDK tool format
  return definitions.map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    execute: (params: unknown) => def.execute(params, ctx),
  }));
}

// OpenCode SDK adapter (when implemented)  
export function toOpenCodeTools(definitions: ToolDefinition[], ctx: SandboxContext) {
  // TODO: Adapt to OpenCode SDK tool format
  return definitions.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.parameters,
    handler: (params: unknown) => def.execute(params, ctx),
  }));
}
```

### Using Shared Tools in Providers

```typescript
// lib/agents/claude-agent.ts (excerpt)

import { sandboxToolDefinitions, toClaudeTools } from "./tool-definitions";

export class ClaudeAgentProvider implements AgentProvider {
  // ...
  
  async *execute(params) {
    const { sandboxContext } = params;
    
    // Convert neutral definitions to Claude SDK format
    const tools = toClaudeTools(sandboxToolDefinitions, sandboxContext);
    
    const sandboxMcp = createSdkMcpServer({
      name: "sandbox",
      tools,
    });
    
    // ... rest of implementation
  }
}
```

---

## API Routes

### Chat Route

```typescript
// app/api/chat/route.ts

import { NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import { getAgent } from "@/lib/agents/registry";

// Request validation schema
const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1),
  agentId: z.string().optional(),
  sandboxId: z.string().optional(),
});

export async function POST(req: Request) {
  // Validate request body
  const parseResult = requestSchema.safeParse(await req.json());
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parseResult.error.issues },
      { status: 400 }
    );
  }

  const { messages, agentId, sandboxId } = parseResult.data;

  const agent = getAgent(agentId ?? "claude-agent");

  // Get existing sandbox or create new one
  let sandbox: Sandbox;
  try {
    sandbox = sandboxId
      ? await Sandbox.get({ sandboxId })
      : await Sandbox.create({
          ports: [3000, 5173], // Next.js and Vite defaults
          timeout: 600_000, // 10 minutes
        });
  } catch (error) {
    return NextResponse.json(
      { error: "Sandbox error", message: "Failed to create or retrieve sandbox" },
      { status: 500 }
    );
  }

  const sandboxContext = {
    sandboxId: sandbox.sandboxId,
    sandbox,
  };

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "user") {
    return NextResponse.json(
      { error: "Last message must be from user" },
      { status: 400 }
    );
  }

  // Stream responses as NDJSON
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Send sandbox ID first
      controller.enqueue(
        encoder.encode(
          JSON.stringify({ type: "sandbox", sandboxId: sandbox.sandboxId }) + "\n"
        )
      );

      try {
        for await (const message of agent.execute({
          prompt: lastMessage.content,
          messages,
          sandboxContext,
        })) {
          controller.enqueue(encoder.encode(JSON.stringify(message) + "\n"));
        }
      } catch (error) {
        // Classify error for better client handling
        const errorType = classifyError(error);
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "error",
              errorType,
              content: error instanceof Error ? error.message : "Unknown error",
              retryable: errorType !== "auth",
            }) + "\n"
          )
        );
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}

function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("rate limit")) return "rate_limit";
  if (message.includes("auth") || message.includes("401")) return "auth";
  if (message.includes("sandbox") || message.includes("expired")) return "sandbox_expired";
  return "agent_error";
}
```

### Deploy Route

See [Deployment Patterns](#deployment-patterns-using-vercelsdk) section for full implementation using `@vercel/sdk`.

### Agents Route

```typescript
// app/api/agents/route.ts

import { NextResponse } from "next/server";
import { listAgents } from "@/lib/agents/registry";

export async function GET() {
  return NextResponse.json({ agents: listAgents() });
}
```

### Sandbox Files Route

List files in sandbox (needed for deployment UI):

```typescript
// app/api/sandboxes/[sandboxId]/files/route.ts

import { NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sandboxId: string }> }
) {
  const { sandboxId } = await params;

  try {
    const sandbox = await Sandbox.get({ sandboxId });
    const result = await sandbox.runCommand({
      cmd: "find",
      args: ["/vercel/sandbox", "-type", "f", "-not", "-path", "*/node_modules/*"],
    });

    const files = result.stdout
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.includes("node_modules"));

    return NextResponse.json({ files });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to list files" },
      { status: 500 }
    );
  }
}
```

### Sandbox Cleanup Route

Stop sandbox when session ends:

```typescript
// app/api/sandboxes/[sandboxId]/route.ts

import { NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ sandboxId: string }> }
) {
  const { sandboxId } = await params;

  try {
    const sandbox = await Sandbox.get({ sandboxId });
    await sandbox.stop();
    return NextResponse.json({ success: true });
  } catch (error) {
    // Sandbox may already be stopped
    return NextResponse.json({ success: true });
  }
}
```

---

## State Management

Using Zustand for app state, with `useChat` from AI SDK for message state:

```typescript
// lib/store.ts

import { create } from "zustand";
import type { DeploymentState } from "./deploy";

// App-level state (not message state - that's in useChat)
interface AppState {
  // Agent selection
  agentId: string;
  setAgentId: (id: string) => void;

  // Sandbox state
  sandboxId: string | null;
  setSandboxId: (id: string | null) => void;
  previewUrl: string | null;
  setPreviewUrl: (url: string | null) => void;

  // File tracking (paths written by agent)
  files: string[];
  addFiles: (paths: string[]) => void;
  clearFiles: () => void;

  // Command logs (for terminal panel)
  commandLogs: string[];
  addCommandLog: (log: string) => void;
  clearCommandLogs: () => void;

  // Deployment state
  deployment: {
    id: string;
    url: string;
    state: DeploymentState;
  } | null;
  setDeployment: (deployment: AppState["deployment"]) => void;

  // Reset all state (new session)
  reset: () => void;
}

const initialState = {
  agentId: "claude-agent",
  sandboxId: null,
  previewUrl: null,
  files: [],
  commandLogs: [],
  deployment: null,
};

export const useAppStore = create<AppState>((set) => ({
  ...initialState,

  setAgentId: (agentId) => set({ agentId }),
  setSandboxId: (sandboxId) => set({ sandboxId }),
  setPreviewUrl: (previewUrl) => set({ previewUrl }),

  addFiles: (paths) =>
    set((state) => ({
      files: [...new Set([...state.files, ...paths])],
    })),
  clearFiles: () => set({ files: [] }),

  addCommandLog: (log) =>
    set((state) => ({
      commandLogs: [...state.commandLogs, log],
    })),
  clearCommandLogs: () => set({ commandLogs: [] }),

  setDeployment: (deployment) => set({ deployment }),

  reset: () => set(initialState),
}));
```

### Message State with useChat

Message state is managed by AI SDK's `useChat` hook - no need to duplicate in Zustand:

```typescript
// hooks/use-app-chat.ts

import { useChat } from "@ai-sdk/react";
import { useAppStore } from "@/lib/store";
import type { ChatMessage, DataPart } from "@/lib/types";
import { useEffect } from "react";

export function useAppChat() {
  const { agentId, sandboxId, setSandboxId, setPreviewUrl, addFiles, addCommandLog } = useAppStore();

  const chat = useChat<ChatMessage>({
    api: "/api/chat",
    body: { agentId, sandboxId },
    // Handle streaming data parts
    onDataPart: (part) => {
      // Type-safe handling of custom data parts
      if (part.type === "data-sandbox-status" && part.data.sandboxId) {
        setSandboxId(part.data.sandboxId);
      }
      if (part.type === "data-preview-url") {
        setPreviewUrl(part.data.url);
      }
      if (part.type === "data-file-progress" && part.data.status === "done") {
        addFiles(part.data.paths);
      }
      if (part.type === "data-command-output") {
        addCommandLog(part.data.output);
      }
    },
  });

  return chat;
}
```

### Processing Data Parts from Stream

Extract sandbox state from the message stream:

```typescript
// lib/process-data-parts.ts

import type { ChatMessage, DataPart } from "./types";

export function extractSandboxId(messages: ChatMessage[]): string | null {
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-sandbox-status" && part.data.sandboxId) {
        return part.data.sandboxId;
      }
    }
  }
  return null;
}

export function extractPreviewUrl(messages: ChatMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    for (const part of message.parts) {
      if (part.type === "data-preview-url") {
        return part.data.url;
      }
    }
  }
  return null;
}

export function extractFiles(messages: ChatMessage[]): string[] {
  const files = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-file-progress" && part.data.status === "done") {
        part.data.paths.forEach((p) => files.add(p));
      }
    }
  }
  return Array.from(files);
}
```

---

## UI Components (using AI Elements + shadcn)

The UI leverages AI Elements - components that **directly use AI SDK types** for zero-conversion type flow.

### Installing Components

Use the shadcn CLI to install AI Elements and base components:

```bash
# Initialize shadcn (if not already done)
npx shadcn@latest init

# Install base shadcn components
npx shadcn@latest add button input textarea collapsible tabs

# Install AI Elements components
npx shadcn@latest add https://ai-sdk.dev/r/conversation
npx shadcn@latest add https://ai-sdk.dev/r/message
npx shadcn@latest add https://ai-sdk.dev/r/prompt-input
npx shadcn@latest add https://ai-sdk.dev/r/file-tree
npx shadcn@latest add https://ai-sdk.dev/r/web-preview
npx shadcn@latest add https://ai-sdk.dev/r/terminal
npx shadcn@latest add https://ai-sdk.dev/r/code-block
npx shadcn@latest add https://ai-sdk.dev/r/tool
npx shadcn@latest add https://ai-sdk.dev/r/reasoning
npx shadcn@latest add https://ai-sdk.dev/r/model-selector
npx shadcn@latest add https://ai-sdk.dev/r/attachments
```

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [Logo]  Platforms Template     [Model: ▼] [Agent: ▼] [Deploy]  │
├─────────────────────────────────────────────────────────────────┤
│                    │                              │              │
│                    │                              │              │
│    Chat Panel      │      Preview Panel          │   Files      │
│   (Conversation)   │      (WebPreview)           │   (FileTree) │
│                    │                              │              │
│                    │                              │              │
│                    │                              │              │
├────────────────────┴──────────────────────────────┴──────────────┤
│  [PromptInput with attachments]                        [Send]    │
└─────────────────────────────────────────────────────────────────┘
```

### Components from AI Elements

| Component | Registry URL | Usage |
|-----------|--------------|-------|
| **Conversation** | `https://ai-sdk.dev/r/conversation` | Auto-scrolling chat container |
| **Message** | `https://ai-sdk.dev/r/message` | User/assistant message with markdown |
| **PromptInput** | `https://ai-sdk.dev/r/prompt-input` | Chat input with file attachments |
| **FileTree** | `https://ai-sdk.dev/r/file-tree` | Hierarchical file explorer |
| **WebPreview** | `https://ai-sdk.dev/r/web-preview` | Sandboxed iframe with URL bar + console |
| **Terminal** | `https://ai-sdk.dev/r/terminal` | ANSI-colored console output |
| **CodeBlock** | `https://ai-sdk.dev/r/code-block` | Syntax-highlighted code with shiki |
| **Tool** | `https://ai-sdk.dev/r/tool` | Tool execution visualization |
| **Reasoning** | `https://ai-sdk.dev/r/reasoning` | "Thinking" indicator |
| **ModelSelector** | `https://ai-sdk.dev/r/model-selector` | AI model dropdown |
| **Attachments** | `https://ai-sdk.dev/r/attachments` | File attachment display |

### Chat Panel Example

```tsx
// components/chat-panel.tsx

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from "@/components/ui/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ui/message";
import { Tool, ToolHeader, ToolContent } from "@/components/ui/tool";
import { Reasoning, ReasoningContent } from "@/components/ui/reasoning";
import { useAppChat } from "@/hooks/use-app-chat";
import type { ChatMessage } from "@/lib/types";

export function ChatPanel() {
  // Messages come from AI SDK's useChat - fully typed
  const { messages } = useAppChat();

  return (
    <Conversation className="h-full">
      <ConversationContent className="p-4 space-y-4">
        {messages.length === 0 ? (
          <ConversationEmptyState
            title="Start building"
            description="Describe what you want to create"
          />
        ) : (
          messages.map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent>
                {message.parts.map((part, i) => (
                  <MessagePart key={i} part={part} />
                ))}
              </MessageContent>
            </Message>
          ))
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

// Type-safe part rendering
function MessagePart({ part }: { part: ChatMessage["parts"][number] }) {
  switch (part.type) {
    case "text":
      return <MessageResponse>{part.text}</MessageResponse>;

    case "reasoning":
      return (
        <Reasoning>
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );

    // Dynamic tools (from MCP)
    case "dynamic-tool":
      return (
        <Tool>
          <ToolHeader
            type="dynamic-tool"
            state={part.state}
            toolName={part.toolName}
          />
          <ToolContent>
            {part.state === "output-available" && (
              <pre className="text-xs">{String(part.output)}</pre>
            )}
            {part.state === "output-error" && (
              <pre className="text-xs text-red-500">{part.errorText}</pre>
            )}
          </ToolContent>
        </Tool>
      );

    // Custom data parts - handle in parent or ignore
    default:
      return null;
  }
}
```

### File Tree Example

```tsx
// components/files-panel.tsx

import {
  FileTree,
  FileTreeFolder,
  FileTreeFile,
} from "@/components/ui/file-tree";
import { useAppStore } from "@/lib/store";

// Convert flat paths to tree structure
function buildTree(paths: string[]) {
  const tree: Record<string, any> = {};
  for (const path of paths) {
    const parts = path.replace("/vercel/sandbox/", "").split("/");
    let current = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        current[part] = null; // File
      } else {
        current[part] = current[part] || {};
        current = current[part];
      }
    }
  }
  return tree;
}

function TreeNode({ name, path, children }: { name: string; path: string; children: any }) {
  if (children === null) {
    return <FileTreeFile path={path} name={name} />;
  }
  return (
    <FileTreeFolder path={path} name={name}>
      {Object.entries(children).map(([childName, childChildren]) => (
        <TreeNode
          key={`${path}/${childName}`}
          name={childName}
          path={`${path}/${childName}`}
          children={childChildren}
        />
      ))}
    </FileTreeFolder>
  );
}

export function FilesPanel() {
  const { files, selectedFile, setSelectedFile } = useAppStore();
  const tree = buildTree(files);

  return (
    <FileTree
      selectedPath={selectedFile}
      onSelect={setSelectedFile}
      defaultExpanded={new Set(files.map((f) => f.split("/").slice(0, -1).join("/")))}
    >
      {Object.entries(tree).map(([name, children]) => (
        <TreeNode key={name} name={name} path={name} children={children} />
      ))}
    </FileTree>
  );
}
```

### Preview Panel Example

```tsx
// components/preview-panel.tsx

import {
  WebPreview,
  WebPreviewNavigation,
  WebPreviewUrl,
  WebPreviewBody,
  WebPreviewConsole,
} from "@/components/ui/web-preview";
import { useAppStore } from "@/lib/store";

export function PreviewPanel() {
  const { previewUrl, consoleLogs } = useAppStore();

  if (!previewUrl) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Preview will appear when dev server starts
      </div>
    );
  }

  return (
    <WebPreview defaultUrl={previewUrl}>
      <WebPreviewNavigation>
        <WebPreviewUrl />
      </WebPreviewNavigation>
      <WebPreviewBody />
      <WebPreviewConsole logs={consoleLogs} />
    </WebPreview>
  );
}
```

### Terminal/Logs Panel Example

```tsx
// components/logs-panel.tsx

import {
  Terminal,
  TerminalHeader,
  TerminalTitle,
  TerminalContent,
  TerminalClearButton,
} from "@/components/ui/terminal";
import { useAppStore } from "@/lib/store";

export function LogsPanel() {
  const { commandLogs, clearLogs } = useAppStore();

  return (
    <Terminal>
      <TerminalHeader>
        <TerminalTitle>Logs</TerminalTitle>
        <TerminalClearButton onClick={clearLogs} />
      </TerminalHeader>
      <TerminalContent
        output={commandLogs.join("\n")}
        autoScroll
      />
    </Terminal>
  );
}
```

### Prompt Input Example

```tsx
// components/chat-input.tsx

import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputTools,
} from "@/components/ui/prompt-input";
import { AgentSelector } from "@/components/agent-selector";
import { useAppChat } from "@/hooks/use-app-chat";

export function ChatInput() {
  // useChat provides append, status, stop - all typed
  const { append, status, stop } = useAppChat();

  return (
    <PromptInput
      onSubmit={async (message) => {
        // message.text and message.files are typed (FileUIPart[])
        await append({
          role: "user",
          content: message.text,
          // Files can be attached via PromptInput's file handling
        });
      }}
    >
      <PromptInputTextarea placeholder="Describe what you want to build..." />
      <PromptInputTools>
        <AgentSelector />
      </PromptInputTools>
      <PromptInputSubmit
        status={status}  // ChatStatus from AI SDK
        onStop={stop}
      />
    </PromptInput>
  );
}
```

### Reference Examples

- **v0-clone**: `ai-elements/packages/examples/src/v0-clone.tsx` - Complete IDE layout
- **chatbot**: `ai-elements/packages/examples/src/chatbot.tsx` - Full chat with tools, branching, attachments

---

## File Structure

```
platform-template/platforms-template/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── api/
│       ├── chat/
│       │   └── route.ts              # Main chat endpoint
│       ├── deploy/
│       │   └── route.ts              # Deploy to Vercel
│       ├── agents/
│       │   └── route.ts              # List available agents
│       └── sandboxes/
│           └── [sandboxId]/
│               ├── route.ts          # DELETE to stop sandbox
│               └── files/
│                   └── route.ts      # GET to list files
├── components/
│   ├── chat-panel.tsx
│   ├── chat-input.tsx
│   ├── preview-panel.tsx
│   ├── files-panel.tsx
│   ├── logs-panel.tsx
│   ├── agent-selector.tsx
│   ├── deploy-button.tsx
│   └── ui/                           # shadcn + AI Elements (installed via CLI)
│       ├── button.tsx
│       ├── conversation.tsx
│       ├── message.tsx
│       ├── prompt-input.tsx
│       ├── file-tree.tsx
│       ├── web-preview.tsx
│       ├── terminal.tsx
│       ├── tool.tsx
│       ├── reasoning.tsx
│       └── ...
├── hooks/
│   ├── use-app-chat.ts               # Wrapper around useChat with app state
│   └── use-deployment.ts             # Deployment state + polling
├── lib/
│   ├── types.ts                      # ChatMessage, DataPart, ToolSet types
│   ├── store.ts                      # Zustand store (app state only)
│   ├── agents/
│   │   ├── types.ts                  # AgentProvider interface
│   │   ├── registry.ts               # Agent registry
│   │   ├── tool-definitions.ts       # Provider-agnostic tool definitions
│   │   ├── claude-agent.ts
│   │   ├── codex-agent.ts
│   │   └── opencode-agent.ts
│   ├── vercel.ts                     # @vercel/sdk client
│   └── deploy.ts                     # Deployment functions
├── middleware.ts                     # Rate limiting (optional)
├── components.json                   # shadcn config
├── package.json
├── tsconfig.json
├── next.config.ts
└── tailwind.config.ts
```

---

## Deployment Patterns (using @vercel/sdk)

All deployment operations use the official `@vercel/sdk` TypeScript SDK.

### Vercel Client Setup

```typescript
// lib/vercel.ts

import { Vercel } from "@vercel/sdk";

export const vercel = new Vercel({
  bearerToken: process.env.VERCEL_TOKEN!,
});

export const TEAM_ID = process.env.VERCEL_TEAM_ID!;
```

### Deployment States

```typescript
// lib/deploy.ts

export type DeploymentState =
  | 'not-deployed'
  | 'deploying'
  | 'queued'
  | 'building'
  | 'failed'
  | 'deployed'
  | 'error';

export function mapReadyStateToDeploymentState(
  readyState: string | undefined
): DeploymentState {
  if (readyState === 'READY') return 'deployed';
  if (readyState && ['BUILDING', 'NOTREADY'].includes(readyState)) return 'building';
  if (readyState && ['ERROR', 'CANCELED'].includes(readyState)) return 'failed';
  if (readyState === 'QUEUED') return 'queued';
  if (readyState === 'INITIALIZING') return 'deploying';
  return 'not-deployed';
}
```

### Deploy Files with @vercel/sdk

```typescript
// lib/deploy.ts

import { Vercel } from "@vercel/sdk";
import type { InlinedFile, ProjectSettings } from "@vercel/sdk/models/createdeploymentop.js";
import { vercel, TEAM_ID } from "./vercel";

const MAX_PROJECT_NAME_LENGTH = 100;

function sanitizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PROJECT_NAME_LENGTH);
}

export async function deployFiles(
  files: InlinedFile[],
  options?: {
    deploymentName?: string;
    projectId?: string;
    projectSettings?: ProjectSettings;
    domain?: string;
  }
) {
  const {
    deploymentName = crypto.randomUUID(),
    projectId,
    projectSettings,
    domain,
  } = options ?? {};

  const sanitizedName = sanitizeProjectName(deploymentName);

  // Create deployment using @vercel/sdk
  const deployment = await vercel.deployments.createDeployment({
    requestBody: {
      name: sanitizedName,
      files,
      project: projectId,
      projectSettings,
      target: "production",
    },
    teamId: TEAM_ID,
  });

  // Make deployments publicly accessible (disable SSO protection)
  if (!projectId) {
    await vercel.projects.updateProject({
      requestBody: { ssoProtection: null },
      idOrName: deployment.projectId!,
      teamId: TEAM_ID,
    });
  }

  // Optionally add custom domain
  if (domain) {
    await vercel.projects.addProjectDomain({
      idOrName: deployment.projectId!,
      requestBody: { name: domain },
      teamId: TEAM_ID,
    });
  }

  return deployment;
}
```

### Get Deployment Status

```typescript
// lib/deploy.ts

export async function getDeploymentStatus(deploymentId: string) {
  const deployment = await vercel.deployments.getDeployment({
    idOrUrl: deploymentId,
    teamId: TEAM_ID,
  });

  return {
    id: deployment.id,
    url: deployment.url,
    readyState: deployment.readyState,
    state: mapReadyStateToDeploymentState(deployment.readyState),
  };
}
```

### Poll for Deployment Completion

```typescript
// lib/deploy.ts

export async function waitForDeployment(
  deploymentId: string,
  options?: {
    maxWaitMs?: number;
    pollIntervalMs?: number;
    onStatusChange?: (state: DeploymentState) => void;
  }
): Promise<{ state: DeploymentState; url?: string }> {
  const {
    maxWaitMs = 4 * 60_000,
    pollIntervalMs = 3_000,
    onStatusChange,
  } = options ?? {};

  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const { readyState, url, state } = await getDeploymentStatus(deploymentId);

    onStatusChange?.(state);

    if (state === 'deployed' || state === 'failed' || state === 'error') {
      return { state, url };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { state: 'error' };
}
```

### Create Project

```typescript
// lib/deploy.ts

export async function createProject(
  name: string,
  options?: {
    framework?: string;
    environmentVariables?: Array<{
      key: string;
      value: string;
      target: ("production" | "preview" | "development")[];
    }>;
  }
) {
  const project = await vercel.projects.createProject({
    teamId: TEAM_ID,
    requestBody: {
      name: sanitizeProjectName(name),
      framework: options?.framework as any,
      environmentVariables: options?.environmentVariables,
    },
  });

  return project;
}
```

### Add Domain to Project

```typescript
// lib/deploy.ts

export async function addProjectDomain(projectId: string, domain: string) {
  return vercel.projects.addProjectDomain({
    idOrName: projectId,
    teamId: TEAM_ID,
    requestBody: { name: domain },
  });
}

export async function getProjectDomains(projectId: string) {
  return vercel.projects.getProjectDomains({
    idOrName: projectId,
    teamId: TEAM_ID,
  });
}
```

### Enhanced Deploy Route

```typescript
// app/api/deploy/route.ts

import { NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import type { InlinedFile } from "@vercel/sdk/models/createdeploymentop.js";
import { deployFiles, getDeploymentStatus } from "@/lib/deploy";

interface RequestBody {
  sandboxId: string;
  files: string[]; // Paths to deploy
  deploymentName?: string;
}

export async function POST(req: Request) {
  const { sandboxId, files, deploymentName } = (await req.json()) as RequestBody;

  const sandbox = await Sandbox.get({ sandboxId });

  // Read all files from sandbox
  const fileContents: InlinedFile[] = await Promise.all(
    files.map(async (path) => {
      const stream = await sandbox.readFile({ path });
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      // Remove /vercel/sandbox prefix for deployment
      const deployPath = path.replace(/^\/vercel\/sandbox\//, "");
      return {
        file: deployPath,
        data: Buffer.concat(chunks).toString("utf-8"),
      };
    })
  );

  // Create deployment using @vercel/sdk
  const deployment = await deployFiles(fileContents, { deploymentName });

  // Return immediately - client polls for status
  return NextResponse.json({
    id: deployment.id,
    url: deployment.url,
    projectId: deployment.projectId,
    state: "deploying",
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing deployment ID" }, { status: 400 });
  }

  const status = await getDeploymentStatus(id);
  return NextResponse.json(status);
}
```

### Client-Side Deployment Hook

```typescript
// hooks/use-deployment.ts

import { useState, useCallback } from "react";
import { useAppStore } from "@/lib/store";

type DeploymentState =
  | "idle"
  | "reading-files"
  | "deploying"
  | "building"
  | "deployed"
  | "failed";

export function useDeployment() {
  const [state, setState] = useState<DeploymentState>("idle");
  const [error, setError] = useState<string | null>(null);
  const { sandboxId, files, setDeployment } = useAppStore();

  const deploy = useCallback(async () => {
    if (!sandboxId || files.length === 0) {
      setError("No files to deploy");
      return;
    }

    setState("reading-files");
    setError(null);

    try {
      // Start deployment
      const response = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId, files }),
      });

      if (!response.ok) {
        throw new Error("Failed to start deployment");
      }

      const { id, url, projectId } = await response.json();
      setState("deploying");

      // Poll for status
      const pollStatus = async () => {
        const statusRes = await fetch(`/api/deploy?id=${id}`);
        const status = await statusRes.json();

        if (status.readyState === "READY") {
          setState("deployed");
          setDeployment({ id, url: `https://${status.url}`, status: "deployed" });
          return;
        }

        if (["ERROR", "CANCELED"].includes(status.readyState)) {
          setState("failed");
          setError("Deployment failed");
          return;
        }

        if (["BUILDING", "NOTREADY"].includes(status.readyState)) {
          setState("building");
        }

        // Continue polling
        setTimeout(pollStatus, 3000);
      };

      pollStatus();
    } catch (err) {
      setState("failed");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [sandboxId, files, setDeployment]);

  return { state, error, deploy };
}
```

---

## Security Considerations

### Path Validation

All file operations validate paths are within `/vercel/sandbox`:

```typescript
if (!path.startsWith("/vercel/sandbox")) {
  return { text: "Error: Path must be within /vercel/sandbox" };
}
```

### Sensitive File Detection

Before deployment, warn about potentially sensitive files:

```typescript
// lib/deploy.ts

const SENSITIVE_PATTERNS = [".env", "credentials", ".pem", ".key", ".secret"];

export function detectSensitiveFiles(files: string[]): string[] {
  return files.filter((f) =>
    SENSITIVE_PATTERNS.some((pattern) => f.toLowerCase().includes(pattern))
  );
}

// In deploy route
const sensitiveFiles = detectSensitiveFiles(files);
if (sensitiveFiles.length > 0) {
  return NextResponse.json(
    {
      error: "Potentially sensitive files detected",
      files: sensitiveFiles,
      message: "Remove these files or confirm deployment",
    },
    { status: 400 }
  );
}
```

### Command Separation

Commands use separate `cmd` and `args` fields to prevent injection:

```typescript
// Good - separate fields
{ cmd: "npm", args: ["install", "lodash"] }

// Bad - string splitting can break on spaces in paths
command.split(" ")
```

### Rate Limiting (Recommended for Production)

```typescript
// middleware.ts (example using Upstash)
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "1 m"), // 10 requests per minute
});

export async function middleware(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "anonymous";
  const { success } = await ratelimit.limit(ip);
  
  if (!success) {
    return new Response("Rate limited", { status: 429 });
  }
}

export const config = {
  matcher: ["/api/chat", "/api/deploy"],
};
```

---

## References

- **ai-elements**: `ai-elements/` - UI component library for AI coding interfaces (FileTree, Terminal, WebPreview, Conversation, etc.)
- **@vercel/sdk**: https://www.npmjs.com/package/@vercel/sdk - Official Vercel TypeScript SDK for deployments, projects, domains
- **v0**: `v0/` - Deployment patterns, status management
- **vibe-coding-platform**: `examples/apps/vibe-coding-platform/` - Reference implementation
- **vercel-platforms-docs**: `vercel-platforms-docs/` - Documentation + reusable components
- **sandbox-sdk**: `sandbox-sdk/` - @vercel/sandbox SDK
- **Claude Agent SDK**: https://docs.claude.com/en/api/agent-sdk/overview
- **AI Elements Docs**: https://ai-sdk.dev/elements - Component documentation
