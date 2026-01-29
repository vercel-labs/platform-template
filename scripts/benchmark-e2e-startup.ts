import { Sandbox } from "@vercel/sandbox";

const SNAPSHOTS = {
  minimal: "snap_X1Uz65k4dG7MTcGld4ZQdcMHpqeW",
  cached: "snap_htgd5PjGaQOyKOdIMGtiMXpFhSl6",
  full: "snap_ZSSVcGWxa8hcHBu0ogrdqThOgKVX",
  current:
    process.env.NEXTJS_SNAPSHOT_ID || "snap_SEwZgtRKfWMorgL58D1BcXdVlAZE",
};

interface Result {
  name: string;
  snapshotId: string;
  createTime: number;
  devServerReady: number;
  totalToReady: number;
  commandAfterReady: number;
}

async function benchmarkSnapshot(
  name: string,
  snapshotId: string,
): Promise<Result> {
  console.log(`\n⏱️  Testing: ${name}`);
  console.log(`   Snapshot: ${snapshotId}`);

  const totalStart = Date.now();

  const createStart = Date.now();
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  const createTime = Date.now() - createStart;
  console.log(`   Create: ${createTime}ms`);

  try {
    const devStart = Date.now();
    sandbox
      .runCommand({
        cmd: "npm",
        args: ["run", "dev"],
        cwd: "/vercel/sandbox",
        detached: true,
      })
      .catch(() => {});

    const url = sandbox.domain(3000);
    let devServerReady = -1;

    for (let i = 0; i < 240; i++) {
      // 60 seconds max
      try {
        const res = await fetch(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok || res.status === 404) {
          devServerReady = Date.now() - devStart;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }

    const totalToReady = Date.now() - totalStart;
    console.log(
      `   Dev server ready: ${devServerReady}ms (total: ${totalToReady}ms)`,
    );

    const cmdStart = Date.now();
    await sandbox.runCommand({
      cmd: "echo",
      args: ["hello"],
      cwd: "/vercel/sandbox",
    });
    const commandAfterReady = Date.now() - cmdStart;
    console.log(`   Command after ready: ${commandAfterReady}ms`);

    return {
      name,
      snapshotId,
      createTime,
      devServerReady,
      totalToReady,
      commandAfterReady,
    };
  } finally {
    await sandbox.stop();
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("END-TO-END STARTUP BENCHMARK");
  console.log("=".repeat(70));
  console.log(
    "\nMeasures: Create sandbox → Start dev server → Server responds\n",
  );

  const results: Result[] = [];

  for (const [name, snapshotId] of Object.entries(SNAPSHOTS)) {
    for (let i = 0; i < 2; i++) {
      try {
        const result = await benchmarkSnapshot(
          `${name} (run ${i + 1})`,
          snapshotId,
        );
        results.push(result);
      } catch (e) {
        console.log(`   ❌ Failed: ${e}`);
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("RESULTS");
  console.log("=".repeat(70));
  console.log(
    "\n" +
      "Name".padEnd(20) +
      "Create".padEnd(10) +
      "Dev Ready".padEnd(12) +
      "Total".padEnd(10) +
      "Cmd After",
  );
  console.log("-".repeat(70));

  for (const r of results) {
    console.log(
      r.name.padEnd(20) +
        `${r.createTime}ms`.padEnd(10) +
        `${r.devServerReady}ms`.padEnd(12) +
        `${r.totalToReady}ms`.padEnd(10) +
        `${r.commandAfterReady}ms`,
    );
  }

  console.log("\n" + "=".repeat(70));
  console.log("AVERAGES");
  console.log("=".repeat(70));

  const groups: Record<string, Result[]> = {};
  for (const r of results) {
    const key = r.name.replace(/ \(run \d\)/, "");
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }

  for (const [name, runs] of Object.entries(groups)) {
    const avgCreate = Math.round(
      runs.reduce((a, r) => a + r.createTime, 0) / runs.length,
    );
    const avgDevReady = Math.round(
      runs.reduce((a, r) => a + r.devServerReady, 0) / runs.length,
    );
    const avgTotal = Math.round(
      runs.reduce((a, r) => a + r.totalToReady, 0) / runs.length,
    );
    const avgCmd = Math.round(
      runs.reduce((a, r) => a + r.commandAfterReady, 0) / runs.length,
    );

    console.log(
      `${name}: create=${avgCreate}ms, dev=${avgDevReady}ms, total=${avgTotal}ms, cmd=${avgCmd}ms`,
    );
  }

  console.log("\n" + "=".repeat(70) + "\n");
}

main().catch(console.error);
