/**
 * Comprehensive Sandbox Benchmark Suite
 * 
 * Tests various aspects of Vercel Sandbox performance:
 * 1. Snapshot vs cold boot startup times
 * 2. Different vCPU configurations
 * 3. Dev server startup times
 * 4. Sandbox reuse (get existing vs create new)
 * 5. Command execution latency
 * 
 * Run with: 
 *   pnpm tsx scripts/benchmark-sandbox-comprehensive.ts
 * 
 * Options (via env vars):
 *   NEXTJS_SNAPSHOT_ID - Required snapshot ID
 *   RUNS - Number of runs per test (default: 3)
 *   SKIP_COLD_BOOT - Skip cold boot test (slow)
 */

import { Sandbox } from "@vercel/sandbox";

const SNAPSHOT_ID = process.env.NEXTJS_SNAPSHOT_ID;
const RUNS = parseInt(process.env.RUNS || "3", 10);
const SKIP_COLD_BOOT = process.env.SKIP_COLD_BOOT === "true";

interface BenchmarkResult {
  name: string;
  runs: number[];
  avg: number;
  min: number;
  max: number;
  p50: number;
}

interface TestResults {
  timestamp: string;
  snapshotId: string | undefined;
  results: Record<string, BenchmarkResult>;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(name: string, runs: number[]): BenchmarkResult {
  const valid = runs.filter(r => r >= 0);
  return {
    name,
    runs,
    avg: valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : -1,
    min: valid.length ? Math.min(...valid) : -1,
    max: valid.length ? Math.max(...valid) : -1,
    p50: valid.length ? percentile(valid, 0.5) : -1,
  };
}

async function waitForServer(url: string, maxWaitMs: number = 60_000): Promise<number> {
  const startTime = Date.now();
  const pollInterval = 250;
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(url, { 
        method: "HEAD",
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok || response.status === 404) {
        return Date.now() - startTime;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  return -1; // Timeout
}

// ============================================================================
// Test 1: Sandbox Creation from Snapshot (different vCPU configs)
// ============================================================================
async function testSnapshotCreation(vcpus: number): Promise<{ createTime: number; sandbox: Sandbox }> {
  const start = Date.now();
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID! },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus },
  });
  const createTime = Date.now() - start;
  return { createTime, sandbox };
}

// ============================================================================
// Test 2: Cold Boot (no snapshot) - Very slow, skip by default
// ============================================================================
async function testColdBoot(vcpus: number): Promise<{ createTime: number; sandbox: Sandbox }> {
  const start = Date.now();
  const sandbox = await Sandbox.create({
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus },
  });
  const createTime = Date.now() - start;
  return { createTime, sandbox };
}

// ============================================================================
// Test 3: Get Existing Sandbox
// ============================================================================
async function testGetExisting(sandboxId: string): Promise<number> {
  const start = Date.now();
  await Sandbox.get({ sandboxId });
  return Date.now() - start;
}

// ============================================================================
// Test 4: Dev Server Startup
// ============================================================================
async function testDevServerStartup(sandbox: Sandbox): Promise<{ cmdTime: number; readyTime: number }> {
  const previewUrl = sandbox.domain(3000);
  
  // Time to kick off command
  const cmdStart = Date.now();
  sandbox.runCommand({
    cmd: "npm",
    args: ["run", "dev"],
    cwd: "/vercel/sandbox",
    detached: true,
  }).catch(() => {});
  const cmdTime = Date.now() - cmdStart;
  
  // Time until server responds
  const readyTime = await waitForServer(previewUrl, 60_000);
  
  return { cmdTime, readyTime };
}

// ============================================================================
// Test 5: Command Execution Latency
// ============================================================================
async function testCommandLatency(sandbox: Sandbox): Promise<{ simple: number; complex: number }> {
  // Simple command
  const simpleStart = Date.now();
  await sandbox.runCommand({ cmd: "echo", args: ["hello"], cwd: "/vercel/sandbox" });
  const simple = Date.now() - simpleStart;
  
  // More complex command (list files)
  const complexStart = Date.now();
  await sandbox.runCommand({ cmd: "ls", args: ["-la"], cwd: "/vercel/sandbox" });
  const complex = Date.now() - complexStart;
  
  return { simple, complex };
}

// ============================================================================
// Test 6: File Operations
// ============================================================================
async function testFileOperations(sandbox: Sandbox): Promise<{ read: number; write: number; list: number }> {
  // Read file
  const readStart = Date.now();
  await sandbox.readFileToBuffer({ path: "/vercel/sandbox/package.json" });
  const read = Date.now() - readStart;
  
  // Write file
  const writeStart = Date.now();
  await sandbox.writeFiles([
    { path: "/vercel/sandbox/test-file.txt", content: Buffer.from("hello world " + Date.now()) }
  ]);
  const write = Date.now() - writeStart;
  
  // List files (using ls command since listFiles may not be available)
  const listStart = Date.now();
  await sandbox.runCommand({ cmd: "ls", args: ["-la"], cwd: "/vercel/sandbox" });
  const list = Date.now() - listStart;
  
  return { read, write, list };
}

// ============================================================================
// Main Benchmark Runner
// ============================================================================
async function runBenchmarks(): Promise<TestResults> {
  const results: TestResults = {
    timestamp: new Date().toISOString(),
    snapshotId: SNAPSHOT_ID,
    results: {},
  };
  
  console.log("\n" + "=".repeat(70));
  console.log("VERCEL SANDBOX COMPREHENSIVE BENCHMARK");
  console.log("=".repeat(70));
  console.log(`Snapshot: ${SNAPSHOT_ID || "none"}`);
  console.log(`Runs per test: ${RUNS}`);
  console.log(`Skip cold boot: ${SKIP_COLD_BOOT}`);
  console.log("=".repeat(70) + "\n");

  if (!SNAPSHOT_ID) {
    console.error("ERROR: NEXTJS_SNAPSHOT_ID is required");
    process.exit(1);
  }

  // Track sandboxes for cleanup
  const sandboxes: Sandbox[] = [];
  
  try {
    // ========================================================================
    // Test 1: Snapshot Creation with Different vCPU Configs
    // ========================================================================
    console.log("\n📦 TEST 1: Sandbox Creation from Snapshot");
    console.log("-".repeat(50));
    
    for (const vcpus of [2, 4]) {
      const times: number[] = [];
      console.log(`\n  Testing ${vcpus} vCPU(s), ${vcpus * 2}GB RAM...`);
      
      for (let i = 0; i < RUNS; i++) {
        process.stdout.write(`    Run ${i + 1}/${RUNS}... `);
        const { createTime, sandbox } = await testSnapshotCreation(vcpus);
        times.push(createTime);
        console.log(`${createTime}ms`);
        
        // Keep first sandbox for other tests
        if (vcpus === 2 && i === 0) {
          sandboxes.push(sandbox);
        } else {
          await sandbox.stop();
        }
      }
      
      results.results[`snapshot-create-${vcpus}vcpu`] = stats(`Snapshot Create (${vcpus} vCPU)`, times);
    }

    // ========================================================================
    // Test 2: Cold Boot (no snapshot) - Very slow!
    // ========================================================================
    if (!SKIP_COLD_BOOT) {
      console.log("\n\n🥶 TEST 2: Cold Boot (No Snapshot) - This is SLOW!");
      console.log("-".repeat(50));
      console.log("  (Only doing 1 run since this takes a while)\n");
      
      process.stdout.write("    Creating sandbox without snapshot... ");
      const { createTime, sandbox } = await testColdBoot(2);
      console.log(`${createTime}ms`);
      await sandbox.stop();
      
      results.results["cold-boot-2vcpu"] = stats("Cold Boot (2 vCPU)", [createTime]);
    }

    // ========================================================================
    // Test 3: Get Existing Sandbox
    // ========================================================================
    console.log("\n\n🔄 TEST 3: Get Existing Sandbox");
    console.log("-".repeat(50));
    
    const existingSandbox = sandboxes[0];
    if (existingSandbox) {
      const times: number[] = [];
      
      for (let i = 0; i < RUNS; i++) {
        process.stdout.write(`    Run ${i + 1}/${RUNS}... `);
        const time = await testGetExisting(existingSandbox.sandboxId);
        times.push(time);
        console.log(`${time}ms`);
      }
      
      results.results["get-existing"] = stats("Get Existing Sandbox", times);
    }

    // ========================================================================
    // Test 4: Dev Server Startup
    // ========================================================================
    console.log("\n\n🚀 TEST 4: Dev Server Startup");
    console.log("-".repeat(50));
    
    const cmdTimes: number[] = [];
    const readyTimes: number[] = [];
    
    for (let i = 0; i < RUNS; i++) {
      console.log(`\n  Run ${i + 1}/${RUNS}:`);
      
      // Create fresh sandbox for each run
      process.stdout.write("    Creating sandbox... ");
      const { createTime, sandbox } = await testSnapshotCreation(2);
      console.log(`${createTime}ms`);
      
      // Start dev server
      process.stdout.write("    Starting dev server... ");
      const { cmdTime, readyTime } = await testDevServerStartup(sandbox);
      cmdTimes.push(cmdTime);
      readyTimes.push(readyTime);
      console.log(`cmd: ${cmdTime}ms, ready: ${readyTime}ms`);
      
      await sandbox.stop();
    }
    
    results.results["dev-server-cmd"] = stats("Dev Server Command", cmdTimes);
    results.results["dev-server-ready"] = stats("Dev Server Ready", readyTimes);

    // ========================================================================
    // Test 5: Command Execution Latency
    // ========================================================================
    console.log("\n\n⚡ TEST 5: Command Execution Latency");
    console.log("-".repeat(50));
    
    // Create a sandbox for command tests
    const { sandbox: cmdSandbox } = await testSnapshotCreation(2);
    sandboxes.push(cmdSandbox);
    
    const simpleTimes: number[] = [];
    const complexTimes: number[] = [];
    
    for (let i = 0; i < RUNS; i++) {
      process.stdout.write(`    Run ${i + 1}/${RUNS}... `);
      const { simple, complex } = await testCommandLatency(cmdSandbox);
      simpleTimes.push(simple);
      complexTimes.push(complex);
      console.log(`echo: ${simple}ms, ls: ${complex}ms`);
    }
    
    results.results["cmd-simple"] = stats("Simple Command (echo)", simpleTimes);
    results.results["cmd-complex"] = stats("Complex Command (ls)", complexTimes);

    // ========================================================================
    // Test 6: File Operations
    // ========================================================================
    console.log("\n\n📁 TEST 6: File Operations");
    console.log("-".repeat(50));
    
    const readTimes: number[] = [];
    const writeTimes: number[] = [];
    const listTimes: number[] = [];
    
    for (let i = 0; i < RUNS; i++) {
      process.stdout.write(`    Run ${i + 1}/${RUNS}... `);
      const { read, write, list } = await testFileOperations(cmdSandbox);
      readTimes.push(read);
      writeTimes.push(write);
      listTimes.push(list);
      console.log(`read: ${read}ms, write: ${write}ms, list: ${list}ms`);
    }
    
    results.results["file-read"] = stats("File Read", readTimes);
    results.results["file-write"] = stats("File Write", writeTimes);
    results.results["file-list"] = stats("File List", listTimes);

    // ========================================================================
    // Test 7: End-to-End (Create + Dev Server Ready)
    // ========================================================================
    console.log("\n\n🏁 TEST 7: End-to-End (Create → Dev Server Ready)");
    console.log("-".repeat(50));
    
    const e2eTimes: number[] = [];
    
    for (let i = 0; i < RUNS; i++) {
      console.log(`\n  Run ${i + 1}/${RUNS}:`);
      
      const totalStart = Date.now();
      
      // Create sandbox
      process.stdout.write("    Creating sandbox... ");
      const { createTime, sandbox } = await testSnapshotCreation(2);
      console.log(`${createTime}ms`);
      
      // Start dev server
      process.stdout.write("    Starting dev server... ");
      const { readyTime } = await testDevServerStartup(sandbox);
      console.log(`${readyTime}ms`);
      
      const totalTime = Date.now() - totalStart;
      e2eTimes.push(totalTime);
      console.log(`    Total: ${totalTime}ms`);
      
      await sandbox.stop();
    }
    
    results.results["e2e-total"] = stats("End-to-End Total", e2eTimes);

  } finally {
    // Cleanup
    console.log("\n\n🧹 Cleaning up sandboxes...");
    for (const sandbox of sandboxes) {
      try {
        await sandbox.stop();
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  return results;
}

// ============================================================================
// Print Summary
// ============================================================================
function printSummary(results: TestResults) {
  console.log("\n" + "=".repeat(70));
  console.log("BENCHMARK SUMMARY");
  console.log("=".repeat(70));
  console.log(`Timestamp: ${results.timestamp}`);
  console.log(`Snapshot: ${results.snapshotId}`);
  console.log("-".repeat(70));
  console.log(
    "Test".padEnd(35) + 
    "Avg".padStart(8) + 
    "Min".padStart(8) + 
    "Max".padStart(8) + 
    "P50".padStart(8)
  );
  console.log("-".repeat(70));
  
  for (const [key, result] of Object.entries(results.results)) {
    const avg = result.avg >= 0 ? `${result.avg}ms` : "N/A";
    const min = result.min >= 0 ? `${result.min}ms` : "N/A";
    const max = result.max >= 0 ? `${result.max}ms` : "N/A";
    const p50 = result.p50 >= 0 ? `${result.p50}ms` : "N/A";
    
    console.log(
      result.name.padEnd(35) + 
      avg.padStart(8) + 
      min.padStart(8) + 
      max.padStart(8) + 
      p50.padStart(8)
    );
  }
  
  console.log("=".repeat(70));
  
  // Key insights
  console.log("\n📊 KEY INSIGHTS:");
  console.log("-".repeat(70));
  
  const snapshotCreate = results.results["snapshot-create-2vcpu"];
  const devReady = results.results["dev-server-ready"];
  const e2e = results.results["e2e-total"];
  const coldBoot = results.results["cold-boot-2vcpu"];
  
  if (snapshotCreate && coldBoot) {
    const speedup = Math.round(coldBoot.avg / snapshotCreate.avg);
    console.log(`• Snapshot speedup vs cold boot: ${speedup}x faster`);
  }
  
  if (e2e) {
    console.log(`• Time to responsive agent: ~${e2e.avg}ms (${(e2e.avg / 1000).toFixed(1)}s)`);
  }
  
  if (devReady) {
    console.log(`• Dev server startup: ~${devReady.avg}ms after sandbox creation`);
  }
  
  // vCPU comparison
  const vcpu2 = results.results["snapshot-create-2vcpu"];
  const vcpu4 = results.results["snapshot-create-4vcpu"];
  
  if (vcpu2 && vcpu4) {
    console.log(`\n• vCPU comparison for sandbox creation:`);
    console.log(`  - 2 vCPU: ${vcpu2.avg}ms`);
    console.log(`  - 4 vCPU: ${vcpu4.avg}ms`);
  }
  
  console.log("\n" + "=".repeat(70));
}

// ============================================================================
// Run
// ============================================================================
async function main() {
  const results = await runBenchmarks();
  printSummary(results);
  
  // Save results to file
  const resultsPath = "scripts/benchmark-results.json";
  const fs = await import("fs");
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\n📄 Results saved to ${resultsPath}\n`);
}

main().catch(console.error);
