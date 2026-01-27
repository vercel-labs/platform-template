
import { Sandbox } from "@vercel/sandbox";

interface SnapshotConfig {
  name: string;
  snapshotId?: string;
  size?: string;
  createTime?: number;
  firstCommandTime?: number;
  secondCommandTime?: number;
  devServerReadyTime?: number;
}

const results: SnapshotConfig[] = [];

async function createMinimalSnapshot(): Promise<string> {
  console.log("\n📦 Creating MINIMAL snapshot (Next.js only)...");
  
  const sandbox = await Sandbox.create({
    timeout: 300_000,
    ports: [3000],
    runtime: "node24",
    resources: { vcpus: 2 },
  });

  try {
    await sandbox.runCommand({
      cmd: "npx",
      args: ["-y", "create-next-app@latest", "/tmp/app", "--yes", "--typescript", "--tailwind", "--eslint", "--app", "--src-dir", "--turbopack", "--no-import-alias"],
      cwd: "/tmp",
      env: { CI: "true" },
    });
    
    await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "cp -r /tmp/app/. /vercel/sandbox/"],
      cwd: "/vercel/sandbox",
    });

    const du = await sandbox.runCommand({ cmd: "du", args: ["-sh", "/vercel/sandbox"], cwd: "/" });
    const size = (await du.stdout()).split("\t")[0];
    
    const snapshot = await sandbox.snapshot();
    console.log(`   ✅ Created: ${snapshot.snapshotId} (${size})`);
    
    results.push({ name: "Minimal", snapshotId: snapshot.snapshotId, size });
    return snapshot.snapshotId;
  } catch (e) {
    await sandbox.stop().catch(() => {});
    throw e;
  }
}

async function createCachedSnapshot(): Promise<string> {
  console.log("\n📦 Creating CACHED snapshot (Next.js + .next cache)...");
  
  const sandbox = await Sandbox.create({
    timeout: 300_000,
    ports: [3000],
    runtime: "node24",
    resources: { vcpus: 2 },
  });

  try {
    await sandbox.runCommand({
      cmd: "npx",
      args: ["-y", "create-next-app@latest", "/tmp/app", "--yes", "--typescript", "--tailwind", "--eslint", "--app", "--src-dir", "--turbopack", "--no-import-alias"],
      cwd: "/tmp",
      env: { CI: "true" },
    });
    
    await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "cp -r /tmp/app/. /vercel/sandbox/"],
      cwd: "/vercel/sandbox",
    });

    const nextConfig = `import type { NextConfig } from "next";
const nextConfig: NextConfig = { experimental: { turbopackFileSystemCacheForDev: true } };
export default nextConfig;`;
    await sandbox.writeFiles([{ path: "/vercel/sandbox/next.config.ts", content: Buffer.from(nextConfig) }]);

    sandbox.runCommand({ cmd: "npm", args: ["run", "dev"], cwd: "/vercel/sandbox", detached: true }).catch(() => {});
    
    for (let i = 0; i < 60; i++) {
      const curl = await sandbox.runCommand({
        cmd: "curl", args: ["-s", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:3000"],
        cwd: "/vercel/sandbox",
      });
      if ((await curl.stdout()).trim() === "200") break;
      await new Promise(r => setTimeout(r, 1000));
    }
    
    await new Promise(r => setTimeout(r, 5000));
    await sandbox.runCommand({ cmd: "sync", cwd: "/vercel/sandbox", sudo: true });

    const du = await sandbox.runCommand({ cmd: "du", args: ["-sh", "/vercel/sandbox"], cwd: "/" });
    const size = (await du.stdout()).split("\t")[0];
    
    const snapshot = await sandbox.snapshot();
    console.log(`   ✅ Created: ${snapshot.snapshotId} (${size})`);
    
    results.push({ name: "Cached", snapshotId: snapshot.snapshotId, size });
    return snapshot.snapshotId;
  } catch (e) {
    await sandbox.stop().catch(() => {});
    throw e;
  }
}

async function createFullSnapshot(): Promise<string> {
  console.log("\n📦 Creating FULL snapshot (Next.js + cache + Claude + Codex)...");
  
  const sandbox = await Sandbox.create({
    timeout: 600_000,
    ports: [3000],
    runtime: "node24",
    resources: { vcpus: 2 },
  });

  try {
    await sandbox.runCommand({
      cmd: "npx",
      args: ["-y", "create-next-app@latest", "/tmp/app", "--yes", "--typescript", "--tailwind", "--eslint", "--app", "--src-dir", "--turbopack", "--no-import-alias"],
      cwd: "/tmp",
      env: { CI: "true" },
    });
    
    await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "cp -r /tmp/app/. /vercel/sandbox/"],
      cwd: "/vercel/sandbox",
    });

    const nextConfig = `import type { NextConfig } from "next";
const nextConfig: NextConfig = { experimental: { turbopackFileSystemCacheForDev: true } };
export default nextConfig;`;
    await sandbox.writeFiles([{ path: "/vercel/sandbox/next.config.ts", content: Buffer.from(nextConfig) }]);

    console.log("   Installing Claude...");
    await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
      cwd: "/vercel/sandbox",
    });

    console.log("   Installing Codex...");
    await sandbox.runCommand({
      cmd: "npm",
      args: ["install", "-g", "@openai/codex"],
      cwd: "/vercel/sandbox",
    });

    console.log("   Building Turbopack cache...");
    sandbox.runCommand({ cmd: "npm", args: ["run", "dev"], cwd: "/vercel/sandbox", detached: true }).catch(() => {});
    
    for (let i = 0; i < 60; i++) {
      const curl = await sandbox.runCommand({
        cmd: "curl", args: ["-s", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:3000"],
        cwd: "/vercel/sandbox",
      });
      if ((await curl.stdout()).trim() === "200") break;
      await new Promise(r => setTimeout(r, 1000));
    }
    
    await new Promise(r => setTimeout(r, 5000));
    await sandbox.runCommand({ cmd: "sync", cwd: "/vercel/sandbox", sudo: true });

    const du = await sandbox.runCommand({ cmd: "du", args: ["-sh", "/vercel/sandbox"], cwd: "/" });
    const size = (await du.stdout()).split("\t")[0];
    
    const snapshot = await sandbox.snapshot();
    console.log(`   ✅ Created: ${snapshot.snapshotId} (${size})`);
    
    results.push({ name: "Full", snapshotId: snapshot.snapshotId, size });
    return snapshot.snapshotId;
  } catch (e) {
    await sandbox.stop().catch(() => {});
    throw e;
  }
}

async function benchmarkSnapshot(config: SnapshotConfig): Promise<void> {
  console.log(`\n⏱️  Benchmarking: ${config.name} (${config.snapshotId})`);
  
  let start = Date.now();
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: config.snapshotId! },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  config.createTime = Date.now() - start;
  console.log(`   Create time: ${config.createTime}ms`);

  try {
    start = Date.now();
    await sandbox.runCommand({ cmd: "echo", args: ["hello"], cwd: "/vercel/sandbox" });
    config.firstCommandTime = Date.now() - start;
    console.log(`   First command: ${config.firstCommandTime}ms`);

    start = Date.now();
    await sandbox.runCommand({ cmd: "ls", args: ["-la"], cwd: "/vercel/sandbox" });
    config.secondCommandTime = Date.now() - start;
    console.log(`   Second command: ${config.secondCommandTime}ms`);

    start = Date.now();
    sandbox.runCommand({ cmd: "npm", args: ["run", "dev"], cwd: "/vercel/sandbox", detached: true }).catch(() => {});
    
    const url = sandbox.domain(3000);
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
        if (res.ok || res.status === 404) {
          config.devServerReadyTime = Date.now() - start;
          break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 250));
    }
    console.log(`   Dev server ready: ${config.devServerReadyTime}ms`);

  } finally {
    await sandbox.stop();
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("SNAPSHOT CONFIGURATION BENCHMARK");
  console.log("=".repeat(70));
  console.log("\nThis will create 3 different snapshots and compare their performance.\n");

  await createMinimalSnapshot();
  await createCachedSnapshot();
  await createFullSnapshot();

  console.log("\n" + "=".repeat(70));
  console.log("BENCHMARKING SNAPSHOTS");
  console.log("=".repeat(70));

  for (const config of results) {
    await benchmarkSnapshot(config);
  }

  console.log("\n" + "=".repeat(70));
  console.log("RESULTS SUMMARY");
  console.log("=".repeat(70));
  console.log("\n" + "Name".padEnd(12) + "Size".padEnd(10) + "Create".padEnd(10) + "1st Cmd".padEnd(12) + "2nd Cmd".padEnd(10) + "Dev Ready");
  console.log("-".repeat(70));
  
  for (const r of results) {
    console.log(
      r.name.padEnd(12) +
      (r.size || "?").padEnd(10) +
      `${r.createTime}ms`.padEnd(10) +
      `${r.firstCommandTime}ms`.padEnd(12) +
      `${r.secondCommandTime}ms`.padEnd(10) +
      `${r.devServerReadyTime}ms`
    );
  }

  console.log("\n" + "=".repeat(70));
  console.log("SNAPSHOT IDs (save these!)");
  console.log("=".repeat(70));
  for (const r of results) {
    console.log(`${r.name.toUpperCase()}_SNAPSHOT_ID=${r.snapshotId}`);
  }
  console.log("=".repeat(70) + "\n");
}

main().catch(console.error);
