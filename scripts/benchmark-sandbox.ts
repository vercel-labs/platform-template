import { Sandbox } from "@vercel/sandbox";

const SNAPSHOT_ID = process.env.NEXTJS_SNAPSHOT_ID!;
const VCPUS = parseInt(process.env.VCPUS || "2", 10);

if (!process.env.NEXTJS_SNAPSHOT_ID) {
  console.error("NEXTJS_SNAPSHOT_ID env var is required");
  process.exit(1);
}

async function waitForServer(
  url: string,
  maxWaitMs: number = 60_000,
): Promise<number> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok || response.status === 404) {
        return Date.now() - startTime;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Server did not respond within ${maxWaitMs}ms`);
}

async function main() {
  console.log(`\n🔧 Benchmark: ${VCPUS} vCPU(s), ${VCPUS * 2}GB RAM`);
  console.log(`📦 Snapshot: ${SNAPSHOT_ID}\n`);

  const timings: Record<string, number> = {};
  let totalStart = Date.now();

  console.log("Creating sandbox from snapshot...");
  let start = Date.now();
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: VCPUS },
  });
  timings["sandbox-create"] = Date.now() - start;
  console.log(
    `✅ Sandbox created: ${sandbox.sandboxId} (${timings["sandbox-create"]}ms)`,
  );

  const previewUrl = sandbox.domain(3000);
  console.log(`🌐 Preview URL: ${previewUrl}`);

  console.log("\nStarting dev server (fire-and-forget)...");
  start = Date.now();
  sandbox
    .runCommand({
      cmd: "npm",
      args: ["run", "dev"],
      cwd: "/vercel/sandbox",
      detached: true,
    })
    .catch((err) => console.error("Dev server error:", err));
  timings["dev-start-cmd"] = Date.now() - start;
  console.log(`✅ Dev command kicked off (${timings["dev-start-cmd"]}ms)`);

  console.log("\nWaiting for server to respond...");
  start = Date.now();
  try {
    const serverReadyTime = await waitForServer(previewUrl);
    timings["server-ready"] = serverReadyTime;
    console.log(`✅ Server ready (${serverReadyTime}ms)`);
  } catch (error) {
    console.error(`❌ ${error}`);
    timings["server-ready"] = -1;
  }

  timings["total"] = Date.now() - totalStart;

  console.log("\n" + "=".repeat(50));
  console.log("BENCHMARK RESULTS");
  console.log("=".repeat(50));
  console.log(`vCPUs:          ${VCPUS}`);
  console.log(`Memory:         ${VCPUS * 2}GB`);
  console.log("-".repeat(50));
  console.log(`Sandbox create: ${timings["sandbox-create"]}ms`);
  console.log(`Dev cmd start:  ${timings["dev-start-cmd"]}ms`);
  console.log(`Server ready:   ${timings["server-ready"]}ms`);
  console.log("-".repeat(50));
  console.log(`TOTAL:          ${timings["total"]}ms`);
  console.log("=".repeat(50));

  console.log("\nStopping sandbox...");
  await sandbox.stop();
  console.log("Done!");
}

main().catch(console.error);
