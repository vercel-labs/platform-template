# Vercel Sandbox Benchmarks & Findings

This document summarizes benchmarking done on Vercel Sandbox startup times and strategies for optimizing responsiveness.

## Key Findings

### Cold Start Penalty: ~11 seconds

Every new sandbox has an unavoidable ~11 second cold start on the **first I/O operation** (file read, write, or command execution).

This cold start is **NOT** affected by:

- Snapshot size (433MB vs 680MB - same ~11s)
- vCPU count (2, 4, 8 vCPUs - same ~11s)
- What's in the snapshot (minimal vs full with AI agents)
- Snapshotting a "warm" sandbox (warmth is not preserved)

### Timing Breakdown

| Operation               | Cold Sandbox  | Warm Sandbox |
| ----------------------- | ------------- | ------------ |
| `Sandbox.create()`      | ~500ms        | N/A          |
| `Sandbox.get()`         | ~100ms        | ~100ms       |
| First I/O operation     | **~11,000ms** | **~200ms**   |
| Subsequent operations   | ~200ms        | ~200ms       |
| Dev server ready        | ~1,700ms      | ~230ms       |
| **Total to responsive** | **~12,000ms** | **~700ms**   |

### What Triggers Cold Start

The ~11s penalty happens on the **first I/O to the sandbox**, which includes:

- `sandbox.runCommand()` - any command
- `sandbox.readFileToBuffer()` - reading files
- `sandbox.writeFiles()` - writing files

Once ANY of these completes, the sandbox is "warm" and all subsequent operations are fast (~200ms).

### Parallel Operations Share Cold Start

If you fire multiple operations in parallel on a cold sandbox, they all complete together in ~11s (not serialized). For example, 3 parallel commands complete in ~11s total, not 33s.

## Snapshot Configurations Tested

| Config                        | Size  | Cold Start | Notes                       |
| ----------------------------- | ----- | ---------- | --------------------------- |
| Minimal (Next.js only)        | 433MB | ~11s       | Fastest subsequent commands |
| With Turbopack cache          | 498MB | ~11s       | Faster dev server startup   |
| With AI agents (Claude+Codex) | 498MB | ~17s       | Slower!                     |
| Current (all agents + cache)  | 680MB | ~21s       | Slowest                     |

**Recommendation:** Use minimal snapshot. AI agents add significant overhead to cold start.

### Snapshot IDs (for testing)

```bash
MINIMAL_SNAPSHOT_ID=snap_X1Uz65k4dG7MTcGld4ZQdcMHpqeW  # 433MB
CACHED_SNAPSHOT_ID=snap_htgd5PjGaQOyKOdIMGtiMXpFhSl6   # 498MB
FULL_SNAPSHOT_ID=snap_ZSSVcGWxa8hcHBu0ogrdqThOgKVX     # 498MB (with agents)
```

Note: Snapshots expire after ~7 days.

## Strategies for Fast Response

### Strategy 1: Accept Cold Start + Show Progress (Current Implementation)

```
User sends message
    ↓
Show "Setting up sandbox..." indicator (~11s)
    ↓
Agent starts responding
    ↓
Hide indicator
```

- **Pros:** Simple, no extra cost
- **Cons:** 11s wait on first message

### Strategy 2: Sandbox Pool (Best UX, Higher Cost)

Pre-warm sandboxes and assign to users on arrival:

```typescript
// Background worker
const warmPool: Sandbox[] = [];

async function maintainPool() {
  while (warmPool.length < 3) {
    const sandbox = await Sandbox.create({ ... });
    await sandbox.runCommand({ cmd: "true" }); // Warm it up
    warmPool.push(sandbox);
  }
}

// When user arrives
function getSandbox() {
  const sandbox = warmPool.shift(); // Instant!
  maintainPool(); // Replenish in background
  return sandbox;
}
```

- **Pros:** Instant response (~700ms)
- **Cons:** Idle sandboxes cost money, complexity

### Strategy 3: Overlap with AI Thinking

Start sandbox warmup while AI is "thinking":

```typescript
// Start warmup immediately
const warmupPromise = sandbox.runCommand({ cmd: "true" });

// AI processes prompt (takes 1-3s typically)
const aiResponse = await generateAIResponse(prompt);

// By now sandbox might be partially warm
await warmupPromise;
```

- **Pros:** Hides some cold start time
- **Cons:** Still ~8-10s if AI is fast

### Strategy 4: Lazy Sandbox Creation

Don't create sandbox until agent actually needs it:

```typescript
// Agent starts responding with text immediately
yield { type: "text", content: "I'll help you build..." };

// Only create sandbox when first tool call happens
if (needsSandbox) {
  sandbox = await createSandbox();
}
```

- **Pros:** Immediate first response
- **Cons:** Delay shifts to when sandbox is actually needed

## Can Sandboxes Fork?

**No.** The SDK only supports:

- `Sandbox.create()` - Creates new sandbox (cold)
- `Sandbox.get()` - Gets reference to existing sandbox
- `sandbox.snapshot()` - Creates snapshot but **stops the sandbox**

There is no way to:

- Fork a running sandbox
- Clone a warm sandbox
- Create a sandbox that inherits runtime warmth

Snapshotting a warm sandbox and creating from that snapshot does NOT preserve warmth - the new sandbox still has the ~11s cold start.

## Resource Configuration

| vCPUs | RAM  | Cold Start | Dev Server |
| ----- | ---- | ---------- | ---------- |
| 2     | 4GB  | ~11s       | ~1.7s      |
| 4     | 8GB  | ~11s       | ~1.7s      |
| 8     | 16GB | ~11s       | ~1.7s      |

More resources don't help with cold start. The bottleneck appears to be infrastructure-level (VM boot, network routing, filesystem mounting).

## Benchmark Scripts

| Script                               | Purpose                     |
| ------------------------------------ | --------------------------- |
| `benchmark-sandbox-comprehensive.ts` | Full benchmark suite        |
| `benchmark-resources.ts`             | Test different vCPU configs |
| `benchmark-warmup-strategies.ts`     | Compare warmup approaches   |
| `benchmark-sandbox-pool.ts`          | Test pool strategy          |
| `benchmark-e2e-startup.ts`           | End-to-end timing           |
| `benchmark-snapshot-configs.ts`      | Compare snapshot sizes      |
| `test-warm-snapshot.ts`              | Test if warm snapshots help |
| `investigate-cold-start.ts`          | Diagnose cold start cause   |
| `inspect-snapshot.ts`                | Show snapshot contents      |

### Running Benchmarks

```bash
cd platform-template

# Set snapshot ID
export NEXTJS_SNAPSHOT_ID=snap_X1Uz65k4dG7MTcGld4ZQdcMHpqeW

# Run comprehensive benchmark
npx tsx scripts/benchmark-sandbox-comprehensive.ts

# Run specific benchmark
npx tsx scripts/benchmark-resources.ts
```

## Current Implementation

The platform currently uses **Strategy 1** (accept cold start + show progress):

1. User sends first message
2. UI shows "Setting up sandbox..." indicator
3. Sandbox is created and warmed (~11s)
4. Indicator disappears when agent starts responding
5. Subsequent messages are fast (~200ms)

Files modified:

- `lib/store/sandbox-store.ts` - Added "warming" status
- `lib/rpc/procedures/chat.ts` - Sends warming/ready status
- `components/chat/chat.tsx` - Shows indicator during warming

## Future Improvements

1. **Sandbox Pool** - Implement for production to eliminate cold start
2. **Minimal Snapshot** - Switch to minimal snapshot, install agents on demand
3. **Regional Optimization** - Test if specific regions have faster cold starts
4. **Metrics** - Track actual cold start times in production for monitoring
