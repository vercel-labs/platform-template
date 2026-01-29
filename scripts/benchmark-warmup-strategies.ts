import { Sandbox } from "@vercel/sandbox";

const SNAPSHOT_ID = "snap_X1Uz65k4dG7MTcGld4ZQdcMHpqeW";

interface Result {
  strategy: string;
  createTime: number;
  warmupTime: number;
  devServerReady: number;
  firstRealCommand: number;
  secondCommand: number;
  totalToFirstCommand: number;
}

async function waitForServer(
  sandbox: Sandbox,
  maxWaitMs = 60000,
): Promise<number> {
  const url = sandbox.domain(3000);
  const start = Date.now();

  for (let i = 0; i < maxWaitMs / 250; i++) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok || res.status === 404) return Date.now() - start;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return -1;
}

async function strategy1_NoWarmup(): Promise<Result> {
  console.log("\n📊 Strategy 1: No warmup (dev server only)");

  const totalStart = Date.now();

  const createStart = Date.now();
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  const createTime = Date.now() - createStart;
  console.log(`   Create: ${createTime}ms`);

  try {
    sandbox
      .runCommand({
        cmd: "npm",
        args: ["run", "dev"],
        cwd: "/vercel/sandbox",
        detached: true,
      })
      .catch(() => {});

    const devServerReady = await waitForServer(sandbox);
    console.log(`   Dev server ready: ${devServerReady}ms`);

    let start = Date.now();
    await sandbox.runCommand({
      cmd: "cat",
      args: ["package.json"],
      cwd: "/vercel/sandbox",
    });
    const firstRealCommand = Date.now() - start;
    console.log(`   First command: ${firstRealCommand}ms`);

    start = Date.now();
    await sandbox.runCommand({
      cmd: "ls",
      args: ["-la"],
      cwd: "/vercel/sandbox",
    });
    const secondCommand = Date.now() - start;
    console.log(`   Second command: ${secondCommand}ms`);

    return {
      strategy: "No warmup",
      createTime,
      warmupTime: 0,
      devServerReady,
      firstRealCommand,
      secondCommand,
      totalToFirstCommand: Date.now() - totalStart - secondCommand,
    };
  } finally {
    await sandbox.stop();
  }
}

async function strategy2_AwaitWarmupFirst(): Promise<Result> {
  console.log("\n📊 Strategy 2: Await warmup command BEFORE dev server");

  const totalStart = Date.now();

  const createStart = Date.now();
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  const createTime = Date.now() - createStart;
  console.log(`   Create: ${createTime}ms`);

  try {
    let start = Date.now();
    await sandbox.runCommand({ cmd: "true", cwd: "/vercel/sandbox" });
    const warmupTime = Date.now() - start;
    console.log(`   Warmup (true): ${warmupTime}ms`);

    sandbox
      .runCommand({
        cmd: "npm",
        args: ["run", "dev"],
        cwd: "/vercel/sandbox",
        detached: true,
      })
      .catch(() => {});

    const devServerReady = await waitForServer(sandbox);
    console.log(`   Dev server ready: ${devServerReady}ms`);

    start = Date.now();
    await sandbox.runCommand({
      cmd: "cat",
      args: ["package.json"],
      cwd: "/vercel/sandbox",
    });
    const firstRealCommand = Date.now() - start;
    console.log(`   First command: ${firstRealCommand}ms`);

    start = Date.now();
    await sandbox.runCommand({
      cmd: "ls",
      args: ["-la"],
      cwd: "/vercel/sandbox",
    });
    const secondCommand = Date.now() - start;
    console.log(`   Second command: ${secondCommand}ms`);

    return {
      strategy: "Await warmup first",
      createTime,
      warmupTime,
      devServerReady,
      firstRealCommand,
      secondCommand,
      totalToFirstCommand: Date.now() - totalStart - secondCommand,
    };
  } finally {
    await sandbox.stop();
  }
}

async function strategy3_LongerWait(): Promise<Result> {
  console.log("\n📊 Strategy 3: Dev server + wait 5s after ready");

  const totalStart = Date.now();

  const createStart = Date.now();
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  const createTime = Date.now() - createStart;
  console.log(`   Create: ${createTime}ms`);

  try {
    sandbox
      .runCommand({
        cmd: "npm",
        args: ["run", "dev"],
        cwd: "/vercel/sandbox",
        detached: true,
      })
      .catch(() => {});

    const devServerReady = await waitForServer(sandbox);
    console.log(`   Dev server ready: ${devServerReady}ms`);

    console.log(`   Waiting 5s after server ready...`);
    await new Promise((r) => setTimeout(r, 5000));

    let start = Date.now();
    await sandbox.runCommand({
      cmd: "cat",
      args: ["package.json"],
      cwd: "/vercel/sandbox",
    });
    const firstRealCommand = Date.now() - start;
    console.log(`   First command: ${firstRealCommand}ms`);

    start = Date.now();
    await sandbox.runCommand({
      cmd: "ls",
      args: ["-la"],
      cwd: "/vercel/sandbox",
    });
    const secondCommand = Date.now() - start;
    console.log(`   Second command: ${secondCommand}ms`);

    return {
      strategy: "Wait 5s after ready",
      createTime,
      warmupTime: 5000,
      devServerReady,
      firstRealCommand,
      secondCommand,
      totalToFirstCommand: Date.now() - totalStart - secondCommand,
    };
  } finally {
    await sandbox.stop();
  }
}

async function strategy4_ParallelWarmup(): Promise<Result> {
  console.log("\n📊 Strategy 4: Parallel warmup + dev server (await both)");

  const totalStart = Date.now();

  const createStart = Date.now();
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  const createTime = Date.now() - createStart;
  console.log(`   Create: ${createTime}ms`);

  try {
    const warmupStart = Date.now();

    const warmupPromise = sandbox.runCommand({
      cmd: "true",
      cwd: "/vercel/sandbox",
    });

    sandbox
      .runCommand({
        cmd: "npm",
        args: ["run", "dev"],
        cwd: "/vercel/sandbox",
        detached: true,
      })
      .catch(() => {});

    await warmupPromise;
    const warmupTime = Date.now() - warmupStart;
    console.log(`   Warmup complete: ${warmupTime}ms`);

    const devServerReady = await waitForServer(sandbox);
    console.log(`   Dev server ready: ${devServerReady}ms (from warmup start)`);

    let start = Date.now();
    await sandbox.runCommand({
      cmd: "cat",
      args: ["package.json"],
      cwd: "/vercel/sandbox",
    });
    const firstRealCommand = Date.now() - start;
    console.log(`   First command: ${firstRealCommand}ms`);

    start = Date.now();
    await sandbox.runCommand({
      cmd: "ls",
      args: ["-la"],
      cwd: "/vercel/sandbox",
    });
    const secondCommand = Date.now() - start;
    console.log(`   Second command: ${secondCommand}ms`);

    return {
      strategy: "Parallel warmup",
      createTime,
      warmupTime,
      devServerReady,
      firstRealCommand,
      secondCommand,
      totalToFirstCommand: Date.now() - totalStart - secondCommand,
    };
  } finally {
    await sandbox.stop();
  }
}

async function strategy5_WarmupBeforeCreate(): Promise<Result> {
  console.log("\n📊 Strategy 5: Reuse sandbox (Sandbox.get instead of create)");

  console.log("   Creating initial sandbox...");
  const initialSandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });

  console.log("   Warming up...");
  await initialSandbox.runCommand({ cmd: "true", cwd: "/vercel/sandbox" });

  const sandboxId = initialSandbox.sandboxId;

  const totalStart = Date.now();

  const createStart = Date.now();
  const sandbox = await Sandbox.get({ sandboxId });
  const createTime = Date.now() - createStart;
  console.log(`   Get existing: ${createTime}ms`);

  try {
    sandbox
      .runCommand({
        cmd: "npm",
        args: ["run", "dev"],
        cwd: "/vercel/sandbox",
        detached: true,
      })
      .catch(() => {});

    const devServerReady = await waitForServer(sandbox);
    console.log(`   Dev server ready: ${devServerReady}ms`);

    let start = Date.now();
    await sandbox.runCommand({
      cmd: "cat",
      args: ["package.json"],
      cwd: "/vercel/sandbox",
    });
    const firstRealCommand = Date.now() - start;
    console.log(`   First command: ${firstRealCommand}ms`);

    start = Date.now();
    await sandbox.runCommand({
      cmd: "ls",
      args: ["-la"],
      cwd: "/vercel/sandbox",
    });
    const secondCommand = Date.now() - start;
    console.log(`   Second command: ${secondCommand}ms`);

    return {
      strategy: "Reuse warm sandbox",
      createTime,
      warmupTime: 0,
      devServerReady,
      firstRealCommand,
      secondCommand,
      totalToFirstCommand: Date.now() - totalStart - secondCommand,
    };
  } finally {
    await sandbox.stop();
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("WARMUP STRATEGY BENCHMARK");
  console.log("=".repeat(70));
  console.log(`\nUsing minimal snapshot: ${SNAPSHOT_ID}\n`);

  const results: Result[] = [];

  results.push(await strategy1_NoWarmup());
  results.push(await strategy2_AwaitWarmupFirst());
  results.push(await strategy3_LongerWait());
  results.push(await strategy4_ParallelWarmup());
  results.push(await strategy5_WarmupBeforeCreate());

  console.log("\n" + "=".repeat(70));
  console.log("RESULTS SUMMARY");
  console.log("=".repeat(70));
  console.log(
    "\n" +
      "Strategy".padEnd(25) +
      "Warmup".padEnd(10) +
      "Dev".padEnd(10) +
      "1st Cmd".padEnd(10) +
      "Total",
  );
  console.log("-".repeat(70));

  for (const r of results) {
    console.log(
      r.strategy.padEnd(25) +
        `${r.warmupTime}ms`.padEnd(10) +
        `${r.devServerReady}ms`.padEnd(10) +
        `${r.firstRealCommand}ms`.padEnd(10) +
        `${r.totalToFirstCommand}ms`,
    );
  }

  console.log("\n" + "=".repeat(70));
  console.log("RECOMMENDATION");
  console.log("=".repeat(70));

  const best = results.reduce((a, b) =>
    a.totalToFirstCommand < b.totalToFirstCommand ? a : b,
  );
  console.log(`\nBest strategy: ${best.strategy}`);
  console.log(
    `Total time to first agent command: ${best.totalToFirstCommand}ms`,
  );
  console.log(`First command latency: ${best.firstRealCommand}ms`);

  console.log("\n" + "=".repeat(70) + "\n");
}

main().catch(console.error);
