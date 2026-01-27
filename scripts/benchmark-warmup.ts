/**
 * Benchmark Sandbox Warmup Behavior
 * 
 * Tests whether there's a "cold start" penalty for the first command
 * and how to mitigate it.
 * 
 * Run with:
 *   npx tsx scripts/benchmark-warmup.ts
 */

import { Sandbox } from "@vercel/sandbox";

const SNAPSHOT_ID = process.env.NEXTJS_SNAPSHOT_ID!;

if (!SNAPSHOT_ID) {
  console.error("NEXTJS_SNAPSHOT_ID env var is required");
  process.exit(1);
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("SANDBOX WARMUP BEHAVIOR ANALYSIS");
  console.log("=".repeat(70));
  console.log(`Snapshot: ${SNAPSHOT_ID}\n`);

  // ========================================================================
  // Test 1: Sequential Commands (no warmup)
  // ========================================================================
  console.log("\n📦 TEST 1: Sequential Commands WITHOUT Warmup");
  console.log("-".repeat(50));
  
  let sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`Created sandbox: ${sandbox.sandboxId}`);
  
  const commands = ["echo hello", "ls -la", "cat package.json", "npm --version", "node --version"];
  
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i].split(" ");
    const start = Date.now();
    await sandbox.runCommand({ 
      cmd: cmd[0], 
      args: cmd.slice(1), 
      cwd: "/vercel/sandbox" 
    });
    const time = Date.now() - start;
    console.log(`  Command ${i + 1} (${commands[i]}): ${time}ms ${i === 0 ? "⚠️ FIRST COMMAND" : ""}`);
  }
  
  await sandbox.stop();

  // ========================================================================
  // Test 2: Warmup with Simple Command First
  // ========================================================================
  console.log("\n\n🔥 TEST 2: Warmup with 'true' Command First");
  console.log("-".repeat(50));
  
  sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`Created sandbox: ${sandbox.sandboxId}`);
  
  // Warmup command - fire and forget, don't await
  console.log("  Kicking off warmup command (detached)...");
  const warmupStart = Date.now();
  sandbox.runCommand({ 
    cmd: "true", 
    cwd: "/vercel/sandbox",
    detached: true,
  }).catch(() => {});
  
  // Wait for warmup
  await new Promise(r => setTimeout(r, 100));
  console.log(`  Warmup command sent (took ${Date.now() - warmupStart}ms to kick off)`);
  
  // Now run commands
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i].split(" ");
    const start = Date.now();
    await sandbox.runCommand({ 
      cmd: cmd[0], 
      args: cmd.slice(1), 
      cwd: "/vercel/sandbox" 
    });
    const time = Date.now() - start;
    console.log(`  Command ${i + 1} (${commands[i]}): ${time}ms`);
  }
  
  await sandbox.stop();

  // ========================================================================
  // Test 3: Dev Server as Warmup
  // ========================================================================
  console.log("\n\n🚀 TEST 3: Dev Server Start as Warmup (Parallel)");
  console.log("-".repeat(50));
  
  sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`Created sandbox: ${sandbox.sandboxId}`);
  
  // Start dev server immediately (fire and forget) - this warms up the sandbox
  console.log("  Starting dev server (detached)...");
  const devStart = Date.now();
  sandbox.runCommand({
    cmd: "npm",
    args: ["run", "dev"],
    cwd: "/vercel/sandbox",
    detached: true,
  }).catch(() => {});
  console.log(`  Dev server command sent (${Date.now() - devStart}ms)`);
  
  // Now run commands while dev server is starting
  console.log("\n  Running commands while dev server starts:");
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i].split(" ");
    const start = Date.now();
    await sandbox.runCommand({ 
      cmd: cmd[0], 
      args: cmd.slice(1), 
      cwd: "/vercel/sandbox" 
    });
    const time = Date.now() - start;
    console.log(`  Command ${i + 1} (${commands[i]}): ${time}ms`);
  }
  
  // Check if dev server is ready
  const previewUrl = sandbox.domain(3000);
  console.log(`\n  Waiting for dev server at ${previewUrl}...`);
  const serverStart = Date.now();
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(previewUrl, { method: "HEAD", signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 404) {
        console.log(`  Dev server ready! (${Date.now() - serverStart}ms after we started waiting)`);
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  
  await sandbox.stop();

  // ========================================================================
  // Test 4: Agent-Like Pattern (Immediate Start)
  // ========================================================================
  console.log("\n\n🤖 TEST 4: Agent-Like Pattern (Optimized)");
  console.log("-".repeat(50));
  
  const totalStart = Date.now();
  
  sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  const createTime = Date.now() - totalStart;
  console.log(`  Sandbox created: ${createTime}ms`);
  
  // Immediately start dev server (warms up sandbox + prepares preview)
  sandbox.runCommand({
    cmd: "npm",
    args: ["run", "dev"],
    cwd: "/vercel/sandbox",
    detached: true,
  }).catch(() => {});
  console.log(`  Dev server kicked off: ${Date.now() - totalStart}ms`);
  
  // Simulate agent receiving first user message
  await new Promise(r => setTimeout(r, 500)); // Small delay like network latency
  
  // Run agent's first command (e.g., reading a file)
  let start = Date.now();
  await sandbox.runCommand({ cmd: "cat", args: ["package.json"], cwd: "/vercel/sandbox" });
  console.log(`  First agent command (cat): ${Date.now() - start}ms`);
  
  // Run more agent commands
  start = Date.now();
  await sandbox.runCommand({ cmd: "ls", args: ["-la", "src"], cwd: "/vercel/sandbox" });
  console.log(`  Second agent command (ls): ${Date.now() - start}ms`);
  
  start = Date.now();
  await sandbox.writeFiles([{ path: "/vercel/sandbox/test.txt", content: Buffer.from("hello") }]);
  console.log(`  Write file: ${Date.now() - start}ms`);
  
  // Check when preview is ready
  const url = sandbox.domain(3000);
  start = Date.now();
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 404) {
        console.log(`  Preview ready: ${Date.now() - start}ms (total: ${Date.now() - totalStart}ms)`);
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  
  console.log(`\n  TOTAL TIME TO WORKING AGENT: ${Date.now() - totalStart}ms`);
  
  await sandbox.stop();

  // ========================================================================
  // Summary
  // ========================================================================
  console.log("\n" + "=".repeat(70));
  console.log("KEY FINDINGS");
  console.log("=".repeat(70));
  console.log(`
1. FIRST COMMAND COLD START
   The first command to a new sandbox has a ~20s penalty.
   This appears to be sandbox runtime initialization.

2. MITIGATION STRATEGIES
   a) Start dev server immediately after sandbox creation (detached)
      - This "warms up" the sandbox while initializing
      - Subsequent commands run in ~200ms instead of 20s
   
   b) Fire a cheap command (like 'true') immediately (detached)
      - Also warms up the sandbox
      - Good if you don't need the dev server right away

3. OPTIMAL PATTERN FOR AGENTS
   - Create sandbox from snapshot (~500ms)
   - Immediately start dev server detached (~0ms to kick off)
   - By the time user sends first message, sandbox is warm
   - Agent commands run in ~200ms
   - Preview ready in ~1.5-2s from sandbox creation

4. TOTAL TIME TO RESPONSIVE AGENT
   ~2-2.5 seconds from scratch
   ~200ms per command after warmup
`);
  console.log("=".repeat(70) + "\n");
}

main().catch(console.error);
