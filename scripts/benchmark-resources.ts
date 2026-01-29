import { Sandbox } from "@vercel/sandbox";

const SNAPSHOT_ID = "snap_X1Uz65k4dG7MTcGld4ZQdcMHpqeW";

interface Result {
  vcpus: number;
  ram: string;
  createTime: number;
  firstCommandTime: number;
  secondCommandTime: number;
  devServerReady: number;
}

async function benchmarkResources(vcpus: number): Promise<Result> {
  const ram = `${vcpus * 2}GB`;
  console.log(`\n⏱️  Testing: ${vcpus} vCPUs, ${ram} RAM`);

  const createStart = Date.now();
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus },
  });
  const createTime = Date.now() - createStart;
  console.log(`   Create: ${createTime}ms`);

  try {
    let start = Date.now();
    await sandbox.runCommand({
      cmd: "echo",
      args: ["hello"],
      cwd: "/vercel/sandbox",
    });
    const firstCommandTime = Date.now() - start;
    console.log(`   First command: ${firstCommandTime}ms`);

    start = Date.now();
    await sandbox.runCommand({
      cmd: "ls",
      args: ["-la"],
      cwd: "/vercel/sandbox",
    });
    const secondCommandTime = Date.now() - start;
    console.log(`   Second command: ${secondCommandTime}ms`);

    start = Date.now();
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
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok || res.status === 404) {
          devServerReady = Date.now() - start;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    console.log(`   Dev server ready: ${devServerReady}ms`);

    return {
      vcpus,
      ram,
      createTime,
      firstCommandTime,
      secondCommandTime,
      devServerReady,
    };
  } finally {
    await sandbox.stop();
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("RESOURCE CONFIGURATION BENCHMARK");
  console.log("=".repeat(70));
  console.log(`\nSnapshot: ${SNAPSHOT_ID}`);
  console.log("Testing: 2, 4, 8 vCPUs (min is 2)\n");

  const results: Result[] = [];
  const vcpuConfigs = [2, 4, 8];

  for (const vcpus of vcpuConfigs) {
    for (let run = 0; run < 2; run++) {
      try {
        const result = await benchmarkResources(vcpus);
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
      "vCPUs".padEnd(8) +
      "RAM".padEnd(8) +
      "Create".padEnd(10) +
      "1st Cmd".padEnd(12) +
      "2nd Cmd".padEnd(10) +
      "Dev Ready",
  );
  console.log("-".repeat(70));

  for (const r of results) {
    console.log(
      `${r.vcpus}`.padEnd(8) +
        r.ram.padEnd(8) +
        `${r.createTime}ms`.padEnd(10) +
        `${r.firstCommandTime}ms`.padEnd(12) +
        `${r.secondCommandTime}ms`.padEnd(10) +
        `${r.devServerReady}ms`,
    );
  }

  console.log("\n" + "=".repeat(70));
  console.log("AVERAGES BY vCPU");
  console.log("=".repeat(70));

  for (const vcpus of vcpuConfigs) {
    const runs = results.filter((r) => r.vcpus === vcpus);
    if (runs.length === 0) continue;

    const avg = (arr: number[]) =>
      Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

    console.log(`\n${vcpus} vCPUs (${vcpus * 2}GB RAM):`);
    console.log(`  Create:      ${avg(runs.map((r) => r.createTime))}ms`);
    console.log(`  First cmd:   ${avg(runs.map((r) => r.firstCommandTime))}ms`);
    console.log(
      `  Second cmd:  ${avg(runs.map((r) => r.secondCommandTime))}ms`,
    );
    console.log(`  Dev ready:   ${avg(runs.map((r) => r.devServerReady))}ms`);
  }

  console.log("\n" + "=".repeat(70) + "\n");
}

main().catch(console.error);
