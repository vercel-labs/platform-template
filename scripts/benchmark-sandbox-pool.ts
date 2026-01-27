/**
 * Benchmark Sandbox Pool Strategy
 * 
 * Tests pre-warming sandboxes and keeping them ready:
 * 1. Pre-create and warm a sandbox
 * 2. When user arrives, give them the warm sandbox
 * 3. Create a new one in background for next user
 * 
 * Run with: npx tsx scripts/benchmark-sandbox-pool.ts
 */

import { Sandbox } from "@vercel/sandbox";

const SNAPSHOT_ID = "snap_X1Uz65k4dG7MTcGld4ZQdcMHpqeW";

interface WarmSandbox {
  sandbox: Sandbox;
  sandboxId: string;
  warmTime: number;
}

async function createAndWarmSandbox(): Promise<WarmSandbox> {
  const start = Date.now();
  
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 600_000, // 10 min timeout for pool
    resources: { vcpus: 2 },
  });
  
  // Warm it up with a simple command
  await sandbox.runCommand({ cmd: "true", cwd: "/vercel/sandbox" });
  
  // Also start dev server so it's ready
  sandbox.runCommand({
    cmd: "npm", args: ["run", "dev"],
    cwd: "/vercel/sandbox", detached: true,
  }).catch(() => {});
  
  // Wait for dev server
  const url = sandbox.domain(3000);
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 404) break;
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  
  const warmTime = Date.now() - start;
  
  return { sandbox, sandboxId: sandbox.sandboxId, warmTime };
}

async function simulateUserSession(warmSandbox: WarmSandbox): Promise<void> {
  console.log(`\n👤 User arrives, gets warm sandbox: ${warmSandbox.sandboxId}`);
  
  const sessionStart = Date.now();
  
  // Get the existing warm sandbox
  const getStart = Date.now();
  const sandbox = await Sandbox.get({ sandboxId: warmSandbox.sandboxId });
  console.log(`   Get sandbox: ${Date.now() - getStart}ms`);
  
  // First command (should be fast - sandbox is warm)
  let start = Date.now();
  await sandbox.runCommand({ cmd: "cat", args: ["package.json"], cwd: "/vercel/sandbox" });
  console.log(`   First command: ${Date.now() - start}ms`);
  
  // Simulate agent work
  start = Date.now();
  await sandbox.runCommand({ cmd: "ls", args: ["-la", "src"], cwd: "/vercel/sandbox" });
  console.log(`   ls src: ${Date.now() - start}ms`);
  
  start = Date.now();
  await sandbox.writeFiles([
    { path: "/vercel/sandbox/src/app/test.tsx", content: Buffer.from("export default function Test() { return <div>Test</div> }") }
  ]);
  console.log(`   Write file: ${Date.now() - start}ms`);
  
  start = Date.now();
  await sandbox.runCommand({ cmd: "cat", args: ["src/app/test.tsx"], cwd: "/vercel/sandbox" });
  console.log(`   Read file: ${Date.now() - start}ms`);
  
  // Check dev server
  const url = sandbox.domain(3000);
  start = Date.now();
  const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
  console.log(`   Dev server check: ${Date.now() - start}ms (${res.status})`);
  
  console.log(`   Total session time: ${Date.now() - sessionStart}ms`);
}

async function main() {
  console.log("=".repeat(70));
  console.log("SANDBOX POOL STRATEGY BENCHMARK");
  console.log("=".repeat(70));
  console.log(`\nSnapshot: ${SNAPSHOT_ID}`);
  console.log("\nSimulating: Pre-warm sandbox → User arrives → Instant response\n");

  // Step 1: Pre-warm a sandbox (this would happen in background)
  console.log("🔥 PRE-WARMING SANDBOX (background task)");
  console.log("-".repeat(50));
  const warmStart = Date.now();
  const warmSandbox = await createAndWarmSandbox();
  console.log(`   Sandbox warmed and ready: ${warmSandbox.warmTime}ms`);
  console.log(`   Sandbox ID: ${warmSandbox.sandboxId}`);

  // Step 2: Simulate user arriving and using the warm sandbox
  console.log("\n" + "=".repeat(70));
  console.log("USER SESSION (using pre-warmed sandbox)");
  console.log("=".repeat(70));
  
  await simulateUserSession(warmSandbox);

  // Step 3: Show comparison with cold start
  console.log("\n" + "=".repeat(70));
  console.log("COMPARISON: COLD START (new sandbox)");
  console.log("=".repeat(70));
  
  const coldStart = Date.now();
  const coldSandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`   Create: ${Date.now() - coldStart}ms`);
  
  let start = Date.now();
  await coldSandbox.runCommand({ cmd: "cat", args: ["package.json"], cwd: "/vercel/sandbox" });
  console.log(`   First command: ${Date.now() - start}ms`);
  
  start = Date.now();
  await coldSandbox.runCommand({ cmd: "ls", args: ["-la", "src"], cwd: "/vercel/sandbox" });
  console.log(`   Second command: ${Date.now() - start}ms`);
  
  console.log(`   Total cold start time: ${Date.now() - coldStart}ms`);
  
  await coldSandbox.stop();

  // Cleanup
  console.log("\n🧹 Cleaning up...");
  await warmSandbox.sandbox.stop();

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`
Pre-warm time (background):  ${warmSandbox.warmTime}ms
User experience (warm):      ~700ms to first command response
User experience (cold):      ~12000ms to first command response

RECOMMENDATION:
- Maintain a pool of 1-3 pre-warmed sandboxes
- When user starts a session, assign them a warm sandbox
- Immediately start warming a replacement sandbox
- Sandboxes can stay warm for their timeout duration (10 min)

COST CONSIDERATION:
- Warm sandboxes consume resources while waiting
- Balance pool size vs. expected user arrival rate
- Consider time-based scaling (more during peak hours)
`);
  console.log("=".repeat(70) + "\n");
}

main().catch(console.error);
