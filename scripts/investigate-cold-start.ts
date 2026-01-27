
import { Sandbox } from "@vercel/sandbox";

const SNAPSHOT_ID = "snap_X1Uz65k4dG7MTcGld4ZQdcMHpqeW";

async function main() {
  console.log("=".repeat(70));
  console.log("COLD START INVESTIGATION");
  console.log("=".repeat(70));

  console.log("\n1️⃣  Test: Multiple parallel commands on cold sandbox");
  console.log("-".repeat(50));
  
  let sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`   Sandbox created: ${sandbox.sandboxId}`);

  console.log("   Firing 3 commands in parallel...");
  const start1 = Date.now();
  const [r1, r2, r3] = await Promise.all([
    sandbox.runCommand({ cmd: "echo", args: ["1"], cwd: "/vercel/sandbox" }),
    sandbox.runCommand({ cmd: "echo", args: ["2"], cwd: "/vercel/sandbox" }),
    sandbox.runCommand({ cmd: "echo", args: ["3"], cwd: "/vercel/sandbox" }),
  ]);
  console.log(`   All 3 completed in: ${Date.now() - start1}ms`);
  console.log(`   (If ~11s, they're serialized. If ~33s, truly parallel but each cold)`);

  const start2 = Date.now();
  await sandbox.runCommand({ cmd: "echo", args: ["4"], cwd: "/vercel/sandbox" });
  console.log(`   4th command: ${Date.now() - start2}ms`);
  
  await sandbox.stop();

  console.log("\n2️⃣  Test: File operations vs command execution on cold sandbox");
  console.log("-".repeat(50));
  
  sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`   Sandbox created: ${sandbox.sandboxId}`);

  let start = Date.now();
  const content = await sandbox.readFileToBuffer({ path: "/vercel/sandbox/package.json" });
  console.log(`   File read (no command): ${Date.now() - start}ms`);

  start = Date.now();
  await sandbox.runCommand({ cmd: "echo", args: ["hello"], cwd: "/vercel/sandbox" });
  console.log(`   First command after file read: ${Date.now() - start}ms`);

  start = Date.now();
  await sandbox.runCommand({ cmd: "ls", args: ["-la"], cwd: "/vercel/sandbox" });
  console.log(`   Second command: ${Date.now() - start}ms`);
  
  await sandbox.stop();

  console.log("\n3️⃣  Test: Only file operations, no commands");
  console.log("-".repeat(50));
  
  sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`   Sandbox created: ${sandbox.sandboxId}`);

  start = Date.now();
  await sandbox.readFileToBuffer({ path: "/vercel/sandbox/package.json" });
  console.log(`   Read 1: ${Date.now() - start}ms`);

  start = Date.now();
  await sandbox.readFileToBuffer({ path: "/vercel/sandbox/tsconfig.json" });
  console.log(`   Read 2: ${Date.now() - start}ms`);

  start = Date.now();
  await sandbox.writeFiles([
    { path: "/vercel/sandbox/test.txt", content: Buffer.from("hello") }
  ]);
  console.log(`   Write: ${Date.now() - start}ms`);

  start = Date.now();
  await sandbox.readFileToBuffer({ path: "/vercel/sandbox/test.txt" });
  console.log(`   Read 3: ${Date.now() - start}ms`);

  start = Date.now();
  await sandbox.runCommand({ cmd: "echo", args: ["first command"], cwd: "/vercel/sandbox" });
  console.log(`   First command (after file ops): ${Date.now() - start}ms`);
  
  await sandbox.stop();

  console.log("\n4️⃣  Test: Detached command + file ops + await command");
  console.log("-".repeat(50));
  
  sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`   Sandbox created: ${sandbox.sandboxId}`);

  start = Date.now();
  const warmupPromise = sandbox.runCommand({ 
    cmd: "sleep", 
    args: ["0.1"], 
    cwd: "/vercel/sandbox",
  });
  console.log(`   Warmup command started`);

  const fileStart = Date.now();
  await sandbox.readFileToBuffer({ path: "/vercel/sandbox/package.json" });
  console.log(`   File read during warmup: ${Date.now() - fileStart}ms`);

  await warmupPromise;
  console.log(`   Warmup complete: ${Date.now() - start}ms total`);

  start = Date.now();
  await sandbox.runCommand({ cmd: "echo", args: ["after warmup"], cwd: "/vercel/sandbox" });
  console.log(`   Command after warmup: ${Date.now() - start}ms`);
  
  await sandbox.stop();

  console.log("\n" + "=".repeat(70));
  console.log("FINDINGS");
  console.log("=".repeat(70));
  console.log(`
The ~11 second cold start appears to be:
- NOT related to snapshot size
- NOT related to vCPU count
- NOT preserved across snapshots
- Happens on FIRST COMMAND execution

This suggests it's the command execution runtime (process spawning,
shell initialization, etc.) that needs to "warm up", not the
filesystem or VM itself.

File operations appear to work without triggering the full cold start.
`);
}

main().catch(console.error);
