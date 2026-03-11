# Platform Template

A vibe coding platform that lets users generate code with AI agents and deploy to Vercel with one click.

## Overview

This template demonstrates building an AI-powered code generation platform using:

- **Orchestrator + Coding Agent** architecture (Claude Agent SDK, OpenAI Codex) with smart routing
- **Vercel Sandbox** for secure code execution (Firecracker MicroVMs)
- **Vercel SDK** for deploying generated code to production
- **Real-time streaming** of AI responses and tool execution with smooth rendering
- **AI Elements** component library for chat UI (Tool calls, Messages, Conversation)

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                       Platform Template                            │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────┐    ┌───────────────────────────────────────────┐ │
│  │   Chat UI    │    │         Orchestrator Agent                │ │
│  │  (AI Elements│───▶│  (claude-sonnet-4-6 via Vercel AI SDK)    │ │
│  │   components)│    │  Routes: answer directly OR call BuildApp │ │
│  └──────────────┘    └──────────────────┬────────────────────────┘ │
│                                         │ BuildApp tool call       │
│                                         ▼                          │
│                      ┌────────────────────────────────────────┐    │
│                      │           Agent Registry               │    │
│                      │  ┌────────────────┬──────────────────┐ │    │
│                      │  │ Claude Agent   │ Codex Agent      │ │    │
│                      │  │ (Agent SDK)    │ (OpenAI Codex)   │ │    │
│                      │  └───────┬────────┴───────┬──────────┘ │    │
│                      └──────────┼────────────────┼────────────┘    │
│                                 └───────┬────────┘                 │
│                                         ▼                          │
│                      ┌────────────────────────────────────────┐    │
│                      │      AI Gateway (VERCEL_OIDC_TOKEN)    │    │
│                      └────────────────────────────────────────┘    │
│                                         │                          │
│                                         ▼                          │
│                      ┌────────────────────────────────────────┐    │
│                      │         Shared MCP Sandbox Tools       │    │
│                      │  read_file │ write_file │ run_command  │    │
│                      └────────────────────────────────────────┘    │
│                                         │                          │
│                                         ▼                          │
│                      ┌────────────────────────────────────────┐    │
│                      │           @vercel/sandbox              │    │
│                      │         (Firecracker MicroVM)          │    │
│                      └────────────────────────────────────────┘    │
│                                         │                          │
│                                         ▼                          │
│                      ┌────────────────────────────────────────┐    │
│                      │          Deploy to Vercel              │    │
│                      │           @vercel/sdk                  │    │
│                      └────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+

### Installation

```bash
pnpm install
```

### Environment Variables

Create a `.env.local` file:

```bash
# AI Gateway (routes all LLM calls)
AI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh
VERCEL_OIDC_TOKEN=        # For AI Gateway auth

# Vercel Deployments
VERCEL_PARTNER_TOKEN=
VERCEL_PARTNER_TEAM_ID=

# Proxy URL
PROXY_BASE_URL=
```

### Development

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Project Structure

```
platform-template/
├── app/                          # Next.js App Router
│   ├── api/
│   │   ├── ai/                   # AI proxy and session management
│   │   ├── auth/                 # Vercel OAuth routes
│   │   └── botid/                # Bot detection
│   ├── rpc/[[...rest]]/          # oRPC endpoint handler
│   ├── page.tsx                  # Main page
│   └── layout.tsx                # Root layout with providers
│
├── components/                   # React components
│   ├── ai-elements/              # AI UI components (chat, tools, terminal)
│   │   ├── conversation.tsx      # Conversation container with auto-scroll
│   │   ├── message.tsx           # Message + streaming markdown renderer
│   │   ├── tool.tsx              # Tool call display (input/output/status)
│   │   ├── code-block.tsx        # Syntax-highlighted code blocks (shiki)
│   │   ├── terminal.tsx          # Terminal output renderer
│   │   ├── file-tree.tsx         # File tree display
│   │   └── web-preview.tsx       # Inline web preview component
│   ├── chat/
│   │   └── chat.tsx              # Main chat panel with streaming logic
│   ├── ui/                       # Base UI components (shadcn/ui)
│   ├── main-layout.tsx           # Main app layout
│   ├── preview.tsx               # Live preview iframe
│   ├── agent-selector.tsx        # Agent selection dropdown
│   ├── template-selector.tsx     # Project template selector
│   ├── deploy-popover.tsx        # Vercel deploy popover
│   └── workspace-panel.tsx       # File explorer/workspace
│
├── lib/                          # Core business logic
│   ├── agents/                   # AI agent system
│   │   ├── types.ts              # AgentProvider interface & StreamChunk types
│   │   ├── registry.ts           # Agent registry (Claude default, Codex)
│   │   ├── claude-agent.ts       # Claude Agent SDK implementation
│   │   ├── codex-agent.ts        # OpenAI Codex implementation
│   │   ├── orchestrator-agent.ts # Routing layer (answer vs. BuildApp)
│   │   └── stream.ts             # Stream utilities
│   ├── auth/                     # Authentication (OAuth, JWT)
│   ├── hooks/                    # React hooks
│   │   ├── use-persisted-chat.ts # Chat history persistence
│   │   └── use-sandbox-from-url.ts
│   ├── rpc/                      # oRPC router & procedures
│   │   └── procedures/           # chat, sandbox, deploy, claim
│   ├── sandbox/                  # Sandbox setup and management
│   ├── templates/                # Project templates (Next.js, Vite)
│   └── store/                    # Zustand state management
│
└── types/                        # Global TypeScript types
```

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16 (App Router) |
| Runtime | React 19 |
| AI SDKs | Claude Agent SDK, Vercel AI SDK v6 |
| Sandbox | @vercel/sandbox (Firecracker MicroVMs) |
| Deployment | @vercel/sdk |
| RPC | oRPC (type-safe) |
| State | Zustand |
| Validation | Zod v4 |
| Styling | Tailwind CSS 4 |
| UI Components | Radix UI |
| Auth | Arctic (OAuth), Jose (JWT) |
| Persistence | Upstash Redis |
| Markdown | streamdown (streaming markdown) |

## Key Patterns

### Two-Layer Agent Architecture

Every message first goes through the **orchestrator agent** (claude-sonnet-4-6 via Vercel AI SDK), which decides whether to:
1. **Answer directly** — for general questions, small talk, or anything that doesn't require code changes
2. **Call `BuildApp`** — to delegate to the selected coding agent (Claude Agent SDK or Codex) inside a Vercel Sandbox

This avoids spinning up a sandbox for simple conversational turns.

### Agent Abstraction

All coding agent SDKs implement a unified `AgentProvider` interface:

```typescript
interface AgentProvider {
  id: string;
  name: string;
  description: string;
  logo: string;
  execute(params: ExecuteParams): AsyncIterable<StreamChunk>;
}
```

### Streaming Architecture

Agents yield `StreamChunk` events that are rendered in real-time:

- `message-start` - New assistant message begins
- `text-delta` - Incremental text (smoothed with 20ms delay)
- `reasoning-delta` - Chain-of-thought text
- `tool-start` - Tool execution beginning
- `tool-input-delta` - Streaming tool input
- `tool-result` - Tool execution result
- `data` - Custom data parts (sandbox status, preview URL, file writes, etc.)
- `error` - Error with optional code

### AI Elements Components

The chat UI is built with a set of composable AI Elements components:

- `<Conversation>` / `<ConversationContent>` — scrollable message container with auto-scroll-to-bottom
- `<Message>` / `<MessageResponse>` — user and assistant message rendering with streaming markdown
- `<Tool>` / `<ToolHeader>` / `<ToolInput>` / `<ToolOutput>` — collapsible tool call display with status badges

### Sandbox-First Execution

All AI-generated code runs in isolated Firecracker MicroVMs via `@vercel/sandbox`. Templates define setup commands per framework. The preview URL is yielded immediately so the iframe loads while the agent works.

### oRPC Type-Safety

Single router definition shared by server and client with full TypeScript inference.

## Scripts

```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm start        # Start production server
pnpm lint         # Run ESLint
pnpm format       # Format with Prettier
pnpm test         # Run tests
pnpm test:watch   # Run tests in watch mode
```

## Learn More

- [Vercel AI SDK](https://sdk.vercel.ai/docs) - AI SDK documentation
- [Vercel Sandbox](https://vercel.com/docs/sandbox) - Sandbox documentation
- [oRPC](https://orpc.unnoq.com/) - Type-safe RPC framework
