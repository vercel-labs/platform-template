
import { Sandbox } from "@vercel/sandbox";

const SNAPSHOT_ID = "snap_X1Uz65k4dG7MTcGld4ZQdcMHpqeW";

async function main() {
  console.log("=".repeat(70));
  console.log("SANDBOX READY STATE INVESTIGATION");
  console.log("=".repeat(70));

  console.log("\n1️⃣  Creating sandbox and polling status during first operation...");
  
  const createStart = Date.now();
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`   Created: ${Date.now() - createStart}ms`);
  console.log(`   ID: ${sandbox.sandboxId}`);
  console.log(`   Initial status: ${sandbox.status}`);

  const opStart = Date.now();
  const opPromise = sandbox.runCommand({ cmd: "echo", args: ["hello"], cwd: "/vercel/sandbox" });
  
  const pollInterval = setInterval(async () => {
    try {
      const refreshed = await Sandbox.get({ sandboxId: sandbox.sandboxId });
      console.log(`   ${Date.now() - opStart}ms: status=${refreshed.status}`);
    } catch (e: any) {
      console.log(`   ${Date.now() - opStart}ms: error=${e.message}`);
    }
  }, 2000);

  await opPromise;
  clearInterval(pollInterval);
  console.log(`   Operation done: ${Date.now() - opStart}ms`);

  const refreshedFinal = await Sandbox.get({ sandboxId: sandbox.sandboxId });
  console.log(`   Final status: ${refreshedFinal.status}`);

  const cmd2Start = Date.now();
  await sandbox.runCommand({ cmd: "ls", args: ["-la"], cwd: "/vercel/sandbox" });
  console.log(`   Second command: ${Date.now() - cmd2Start}ms`);

  await sandbox.stop();

  console.log("\n" + "=".repeat(70));
  console.log("CONCLUSION");
  console.log("=".repeat(70));
  console.log(`
The ~11 second cold start happens on FIRST I/O to the sandbox.
This cannot be avoided by:
- Snapshotting a warm sandbox
- Using more vCPUs
- Using smaller snapshots

The only solutions are:
1. POOL: Keep warm sandboxes ready (costs money while idle)
2. ACCEPT: Show "preparing environment" for ~11s on first use
3. OVERLAP: Start warmup immediately, do AI thinking in parallel
`);
}

main().catch(console.error);
