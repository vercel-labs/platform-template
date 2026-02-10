# Platform Template

A vibe coding platform that lets users generate code with AI agents and deploy to Vercel with one click.

## Overview

This template demonstrates building an AI-powered code generation platform using:

- **AI Agents** (Claude Agent SDK, OpenAI Codex) running in isolated sandboxes
- **Vercel Sandbox** for secure code execution
- **Vercel SDK** for deploying generated code to production
- **Real-time streaming** of AI responses and tool execution

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Platform Template                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌─────────────────────────────────────────┐ │
│  │   Chat UI    │    │           Agent Registry                │ │
│  │              │    │  ┌─────────────┬─────────────────────┐  │ │
│  │ [Agent: ▼]   │───▶│  │ Claude Agent│ Codex Agent         │  │ │
│  └──────────────┘    │  │ SDK         │ SDK                 │  │ │
│                      │  └──────┬──────┴──────┬──────────────┘  │ │
│                      └─────────┼─────────────┼─────────────────┘ │
│                                └──────┬──────┘                   │
│                                       ▼                          │
│                      ┌────────────────────────────────────────┐  │
│                      │      AI Gateway (VERCEL_OIDC_TOKEN)    │  │
│                      └────────────────────────────────────────┘  │
│                                       │                          │
│                                       ▼                          │
│                      ┌────────────────────────────────────────┐  │
│                      │         Shared MCP Sandbox Tools       │  │
│                      │  read_file │ write_file │ run_command  │  │
│                      └────────────────────────────────────────┘  │
│                                       │                          │
│                                       ▼                          │
│                      ┌────────────────────────────────────────┐  │
│                      │           @vercel/sandbox              │  │
│                      │         (Firecracker MicroVM)          │  │
│                      └────────────────────────────────────────┘  │
│                                       │                          │
│                                       ▼                          │
│                      ┌────────────────────────────────────────┐  │
│                      │          Deploy to Vercel              │  │
│                      │           @vercel/sdk                  │  │
│                      └────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
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
│   │   └── auth/                 # Vercel OAuth routes
│   ├── rpc/[[...rest]]/          # oRPC endpoint handler
│   ├── page.tsx                  # Main page
│   └── layout.tsx                # Root layout with providers
│
├── components/                   # React components
│   ├── ai-elements/              # AI UI components (chat, tools, terminal)
│   ├── ui/                       # Base UI components (shadcn/ui)
│   ├── main-layout.tsx           # Main app layout
│   ├── preview.tsx               # Live preview iframe
│   └── workspace-panel.tsx       # File explorer/workspace
│
├── lib/                          # Core business logic
│   ├── agents/                   # AI agent system
│   │   ├── types.ts              # Agent interfaces & StreamChunk types
│   │   ├── registry.ts           # Agent registry
│   │   ├── claude-agent.ts       # Claude Agent SDK implementation
│   │   └── codex-agent.ts        # OpenAI Codex implementation
│   ├── auth/                     # Authentication (OAuth, JWT)
│   ├── rpc/                      # oRPC router & procedures
│   │   └── procedures/           # chat, sandbox, deploy, claim
│   ├── templates/                # Project templates (Next.js, Vite)
│   └── store/                    # Zustand state management
│
├── sdk/                          # Bundled @vercel/sdk
└── scripts/                      # Development & benchmark scripts
```

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16 (App Router) |
| Runtime | React 19 |
| AI SDKs | Claude Agent SDK, Vercel AI SDK |
| Sandbox | @vercel/sandbox (Firecracker MicroVMs) |
| Deployment | @vercel/sdk |
| RPC | oRPC (type-safe) |
| State | Zustand |
| Validation | Zod |
| Styling | Tailwind CSS 4 |
| UI Components | Radix UI |
| Auth | Arctic (OAuth), Jose (JWT) |
| Persistence | Upstash Redis |

## Key Patterns

### Agent Abstraction

All agent SDKs implement a unified `AgentProvider` interface, making it easy to swap implementations:

```typescript
interface AgentProvider {
  id: string;
  name: string;
  execute(params: {
    prompt: string;
    sandboxContext: SandboxContext;
    signal?: AbortSignal;
  }): AsyncIterable<StreamChunk>;
}
```

### Streaming Architecture

Agents yield `StreamChunk` events that get accumulated into `UIMessage` format:

- `text-delta` - Incremental text output
- `tool-start` - Tool execution beginning
- `tool-result` - Tool execution result
- `data` - Custom data parts (sandbox status, file writes, etc.)

### Sandbox-First Execution

All AI-generated code runs in isolated Firecracker MicroVMs via `@vercel/sandbox`. Templates define setup commands per framework.

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

- [PLAN.md](./PLAN.md) - Detailed architecture documentation
- [Vercel AI SDK](https://sdk.vercel.ai/docs) - AI SDK documentation
- [Vercel Sandbox](https://vercel.com/docs/sandbox) - Sandbox documentation
- [oRPC](https://orpc.unnoq.com/) - Type-safe RPC framework
