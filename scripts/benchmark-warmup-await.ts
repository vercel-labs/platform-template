import { Sandbox } from "@vercel/sandbox";

const SNAPSHOT_ID = process.env.NEXTJS_SNAPSHOT_ID!;

if (!SNAPSHOT_ID) {
  console.error("NEXTJS_SNAPSHOT_ID env var is required");
  process.exit(1);
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("WARMUP AWAIT BEHAVIOR ANALYSIS");
  console.log("=".repeat(70));
  console.log(`Snapshot: ${SNAPSHOT_ID}\n`);

  console.log("\n⏳ TEST 1: AWAIT Warmup Command Before Real Commands");
  console.log("-".repeat(50));

  let totalStart = Date.now();
  let sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`  Sandbox created: ${Date.now() - totalStart}ms`);

  let start = Date.now();
  console.log("  Awaiting warmup command (true)...");
  await sandbox.runCommand({ cmd: "true", cwd: "/vercel/sandbox" });
  console.log(`  Warmup complete: ${Date.now() - start}ms`);

  start = Date.now();
  await sandbox.runCommand({
    cmd: "echo",
    args: ["hello"],
    cwd: "/vercel/sandbox",
  });
  console.log(`  echo hello: ${Date.now() - start}ms`);

  start = Date.now();
  await sandbox.runCommand({
    cmd: "ls",
    args: ["-la"],
    cwd: "/vercel/sandbox",
  });
  console.log(`  ls -la: ${Date.now() - start}ms`);

  start = Date.now();
  await sandbox.runCommand({
    cmd: "cat",
    args: ["package.json"],
    cwd: "/vercel/sandbox",
  });
  console.log(`  cat package.json: ${Date.now() - start}ms`);

  console.log(`  Total time: ${Date.now() - totalStart}ms`);
  await sandbox.stop();

  console.log(
    "\n\n🚀 TEST 2: Start Dev Server (detached) + Wait for Startup, THEN Commands",
  );
  console.log("-".repeat(50));

  totalStart = Date.now();
  sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`  Sandbox created: ${Date.now() - totalStart}ms`);

  sandbox
    .runCommand({
      cmd: "npm",
      args: ["run", "dev"],
      cwd: "/vercel/sandbox",
      detached: true,
    })
    .catch(() => {});
  console.log(`  Dev server kicked off: ${Date.now() - totalStart}ms`);

  const url = sandbox.domain(3000);
  console.log(`  Waiting for dev server at ${url}...`);
  start = Date.now();
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok || res.status === 404) {
        console.log(`  Dev server ready: ${Date.now() - start}ms`);
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  start = Date.now();
  await sandbox.runCommand({
    cmd: "echo",
    args: ["hello"],
    cwd: "/vercel/sandbox",
  });
  console.log(`  echo hello: ${Date.now() - start}ms`);

  start = Date.now();
  await sandbox.runCommand({
    cmd: "ls",
    args: ["-la"],
    cwd: "/vercel/sandbox",
  });
  console.log(`  ls -la: ${Date.now() - start}ms`);

  start = Date.now();
  await sandbox.runCommand({
    cmd: "cat",
    args: ["package.json"],
    cwd: "/vercel/sandbox",
  });
  console.log(`  cat package.json: ${Date.now() - start}ms`);

  console.log(`  Total time: ${Date.now() - totalStart}ms`);
  await sandbox.stop();

  console.log("\n\n⚡ TEST 3: Background Warmup During 'Think Time'");
  console.log("-".repeat(50));
  console.log("  Simulating: Create sandbox → AI thinks → First command");

  totalStart = Date.now();
  sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`  Sandbox created: ${Date.now() - totalStart}ms`);

  const devServerPromise = sandbox
    .runCommand({
      cmd: "npm",
      args: ["run", "dev"],
      cwd: "/vercel/sandbox",
      detached: true,
    })
    .catch(() => {});
  console.log(`  Dev server started (detached): ${Date.now() - totalStart}ms`);

  console.log("  Simulating AI thinking for 2 seconds...");
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`  AI done thinking: ${Date.now() - totalStart}ms`);

  start = Date.now();
  await sandbox.runCommand({
    cmd: "echo",
    args: ["hello"],
    cwd: "/vercel/sandbox",
  });
  console.log(`  echo hello: ${Date.now() - start}ms`);

  start = Date.now();
  await sandbox.runCommand({
    cmd: "ls",
    args: ["-la"],
    cwd: "/vercel/sandbox",
  });
  console.log(`  ls -la: ${Date.now() - start}ms`);

  console.log(`  Total time: ${Date.now() - totalStart}ms`);
  await sandbox.stop();

  console.log(
    "\n\n⏰ TEST 4: Wait 25 seconds after sandbox creation (no commands)",
  );
  console.log("-".repeat(50));

  totalStart = Date.now();
  sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`  Sandbox created: ${Date.now() - totalStart}ms`);

  console.log("  Waiting 25 seconds (no commands)...");
  await new Promise((r) => setTimeout(r, 25000));
  console.log(`  Wait complete: ${Date.now() - totalStart}ms`);

  start = Date.now();
  await sandbox.runCommand({
    cmd: "echo",
    args: ["hello"],
    cwd: "/vercel/sandbox",
  });
  console.log(`  echo hello: ${Date.now() - start}ms`);

  start = Date.now();
  await sandbox.runCommand({
    cmd: "ls",
    args: ["-la"],
    cwd: "/vercel/sandbox",
  });
  console.log(`  ls -la: ${Date.now() - start}ms`);

  console.log(`  Total time: ${Date.now() - totalStart}ms`);
  await sandbox.stop();

  console.log("\n" + "=".repeat(70));
  console.log("FINDINGS");
  console.log("=".repeat(70));
}

main().catch(console.error);
