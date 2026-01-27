/**
 * Test: Can we snapshot a WARM sandbox and fork from it?
 * 
 * The idea:
 * 1. Create sandbox from base snapshot
 * 2. Warm it up (run a command to trigger the ~11s init)
 * 3. Snapshot the WARM sandbox
 * 4. Create new sandboxes from the warm snapshot
 * 5. See if they skip the cold start
 * 
 * Run with: npx tsx scripts/test-warm-snapshot.ts
 */

import { Sandbox } from "@vercel/sandbox";

const BASE_SNAPSHOT_ID = "snap_X1Uz65k4dG7MTcGld4ZQdcMHpqeW"; // minimal

async function main() {
  console.log("=".repeat(70));
  console.log("TEST: WARM SNAPSHOT FORKING");
  console.log("=".repeat(70));
  console.log(`\nBase snapshot: ${BASE_SNAPSHOT_ID}\n`);

  // Step 1: Create sandbox from base snapshot
  console.log("1️⃣  Creating sandbox from base snapshot...");
  let start = Date.now();
  const baseSandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: BASE_SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`   Created: ${Date.now() - start}ms`);
  console.log(`   Sandbox ID: ${baseSandbox.sandboxId}`);

  // Step 2: Warm it up
  console.log("\n2️⃣  Warming up the sandbox (first command)...");
  start = Date.now();
  await baseSandbox.runCommand({ cmd: "echo", args: ["warming up"], cwd: "/vercel/sandbox" });
  console.log(`   Warmup complete: ${Date.now() - start}ms`);

  // Verify it's warm
  start = Date.now();
  await baseSandbox.runCommand({ cmd: "echo", args: ["second"], cwd: "/vercel/sandbox" });
  console.log(`   Second command: ${Date.now() - start}ms (should be fast)`);

  // Step 3: Snapshot the WARM sandbox
  console.log("\n3️⃣  Snapshotting the WARM sandbox...");
  console.log("   (Note: This STOPS the sandbox)");
  start = Date.now();
  const warmSnapshot = await baseSandbox.snapshot();
  console.log(`   Snapshot created: ${Date.now() - start}ms`);
  console.log(`   Warm Snapshot ID: ${warmSnapshot.snapshotId}`);

  // Step 4: Create new sandboxes from the warm snapshot
  console.log("\n4️⃣  Creating sandboxes from WARM snapshot...");
  
  for (let i = 1; i <= 3; i++) {
    console.log(`\n   --- Run ${i} ---`);
    
    start = Date.now();
    const newSandbox = await Sandbox.create({
      source: { type: "snapshot", snapshotId: warmSnapshot.snapshotId },
      ports: [3000],
      timeout: 300_000,
      resources: { vcpus: 2 },
    });
    console.log(`   Create: ${Date.now() - start}ms`);

    // First command - is it fast?
    start = Date.now();
    await newSandbox.runCommand({ cmd: "echo", args: ["hello"], cwd: "/vercel/sandbox" });
    const firstCmd = Date.now() - start;
    console.log(`   First command: ${firstCmd}ms ${firstCmd < 1000 ? "✅ FAST!" : "❌ Still slow"}`);

    // Second command
    start = Date.now();
    await newSandbox.runCommand({ cmd: "ls", args: ["-la"], cwd: "/vercel/sandbox" });
    console.log(`   Second command: ${Date.now() - start}ms`);

    await newSandbox.stop();
  }

  // Step 5: Compare with base snapshot
  console.log("\n5️⃣  Comparison: Creating from BASE snapshot...");
  
  start = Date.now();
  const coldSandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: BASE_SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`   Create: ${Date.now() - start}ms`);

  start = Date.now();
  await coldSandbox.runCommand({ cmd: "echo", args: ["hello"], cwd: "/vercel/sandbox" });
  const coldFirstCmd = Date.now() - start;
  console.log(`   First command: ${coldFirstCmd}ms ${coldFirstCmd < 1000 ? "✅ FAST!" : "❌ Slow (expected)"}`);

  await coldSandbox.stop();

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`
Warm Snapshot ID: ${warmSnapshot.snapshotId}

If sandboxes from the warm snapshot have fast first commands (~200ms),
then we can use this strategy:

1. Periodically create and warm a "template" sandbox
2. Snapshot it while warm
3. Create user sandboxes from the warm snapshot
4. Repeat to keep warm snapshots fresh (they expire in 7 days)

This would give users instant responsiveness without maintaining
a pool of running sandboxes.
`);
  console.log("=".repeat(70) + "\n");
}

main().catch(console.error);
