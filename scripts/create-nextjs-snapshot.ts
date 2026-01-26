/**
 * Script to create a Next.js sandbox snapshot
 *
 * Run with: pnpm tsx scripts/create-nextjs-snapshot.ts
 *
 * This creates a snapshot with:
 * - Next.js 15 + React 19 + TypeScript
 * - Tailwind CSS configured
 * - shadcn/ui initialized (add components with: npx shadcn@latest add <name>)
 * - All dependencies pre-installed (no npm install needed)
 *
 * Note: Snapshots expire after 7 days, so you'll need to recreate periodically.
 */

import { Sandbox } from "@vercel/sandbox";
import { writeFileSync, appendFileSync, existsSync, readFileSync } from "fs";

async function main() {
  console.log("🚀 Creating Next.js sandbox snapshot...\n");

  const sandbox = await Sandbox.create({
    timeout: 600_000, // 10 minutes for setup
    ports: [3000],
    runtime: "node24",
    resources: { vcpus: 2 }, // 2 vCPUs, 4GB RAM
  });

  console.log(`📦 Sandbox created: ${sandbox.sandboxId}\n`);

  try {
    // Step 1: Create Next.js app
    // Create in a temp directory then move to /vercel/sandbox
    console.log("1️⃣  Running create-next-app...");
    
    // First, create the app in /tmp
    const createApp = await sandbox.runCommand({
      cmd: "npx",
      args: [
        "-y",
        "create-next-app@latest",
        "/tmp/app",
        "--yes",
        "--typescript",
        "--tailwind", 
        "--eslint",
        "--app",
        "--src-dir",
        "--turbopack",
        "--no-import-alias",
      ],
      cwd: "/tmp",
      env: { CI: "true" },
    });

    const createStdout = await createApp.stdout();
    const createStderr = await createApp.stderr();
    console.log("   stdout:", createStdout);
    if (createStderr) console.log("   stderr:", createStderr);

    if (createApp.exitCode !== 0) {
      throw new Error(`create-next-app failed with exit code ${createApp.exitCode}`);
    }
    
    // Move files from /tmp/app to /vercel/sandbox
    console.log("   Moving files to /vercel/sandbox...");
    const moveFiles = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "cp -r /tmp/app/. /vercel/sandbox/"],
      cwd: "/vercel/sandbox",
    });
    
    if (moveFiles.exitCode !== 0) {
      const stderr = await moveFiles.stderr();
      throw new Error(`Failed to move files: ${stderr}`);
    }
    
    // Verify files were created
    const verifyLs = await sandbox.runCommand({
      cmd: "ls",
      args: ["-la"],
      cwd: "/vercel/sandbox",
    });
    console.log("   Files after setup:");
    console.log(await verifyLs.stdout());
    
    // Check if package.json exists
    const pkgCheck = await sandbox.readFileToBuffer({ path: "/vercel/sandbox/package.json" });
    if (!pkgCheck) {
      throw new Error("package.json not found!");
    }
    console.log("   ✅ Next.js app created\n");

    // Step 2: Initialize shadcn/ui
    console.log("2️⃣  Initializing shadcn/ui...");
    const shadcnInit = await sandbox.runCommand({
      cmd: "npx",
      args: ["shadcn@latest", "init", "-y", "-d"],
      cwd: "/vercel/sandbox",
    });
    
    if (shadcnInit.exitCode !== 0) {
      console.log("   ⚠️  shadcn init had issues (non-fatal)");
    } else {
      console.log("   ✅ shadcn/ui initialized\n");
    }

    // Step 3: Update next.config.ts to enable Turbopack filesystem cache
    console.log("3️⃣  Configuring Next.js with Turbopack filesystem cache...");
    const nextConfig = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
};

export default nextConfig;
`;
    await sandbox.writeFiles([
      { path: "/vercel/sandbox/next.config.ts", content: Buffer.from(nextConfig) },
    ]);
    console.log("   ✅ next.config.ts updated\n");

    // Step 4: Clean up the default page to be minimal
    console.log("4️⃣  Setting up minimal starter page...");
    const minimalPage = `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Welcome to your app</h1>
      <p className="mt-4 text-muted-foreground">Edit src/app/page.tsx to get started</p>
    </main>
  );
}
`;
    await sandbox.writeFiles([
      { path: "/vercel/sandbox/src/app/page.tsx", content: Buffer.from(minimalPage) },
    ]);
    console.log("   ✅ Starter page created\n");

    // Step 5: Start dev server and wait for it to compile (builds .next cache)
    console.log("5️⃣  Starting dev server to build Turbopack cache...");
    
    // Start dev server in background
    sandbox.runCommand({
      cmd: "npm",
      args: ["run", "dev"],
      cwd: "/vercel/sandbox",
      detached: true,
    }).catch(() => {});
    
    // Wait for server to be ready (compiles the app)
    console.log("   Waiting for compilation...");
    for (let i = 0; i < 60; i++) {
      const curl = await sandbox.runCommand({
        cmd: "curl",
        args: ["-s", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:3000"],
        cwd: "/vercel/sandbox",
      });
      const status = (await curl.stdout()).trim();
      if (status === "200") {
        console.log("   ✅ Server compiled and ready");
        break;
      }
      if (i === 59) {
        console.log("   ⚠️  Server didn't respond in time, continuing anyway");
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // Wait for Turbopack to flush its cache to disk
    console.log("   Waiting for Turbopack cache to flush (5s)...");
    await new Promise(r => setTimeout(r, 5000));
    
    // Sync filesystem to ensure all data is written to disk
    console.log("   Syncing filesystem...");
    await sandbox.runCommand({
      cmd: "sync",
      cwd: "/vercel/sandbox",
      sudo: true,
    });
    
    // Check Turbopack cache size
    const cacheSize = await sandbox.runCommand({
      cmd: "du",
      args: ["-sh", ".next/dev/cache/turbopack"],
      cwd: "/vercel/sandbox",
    });
    const cacheSizeStr = (await cacheSize.stdout()).trim();
    console.log(`   Turbopack cache size: ${cacheSizeStr.split('\t')[0]}`);
    
    // Check .next folder structure
    const lsNext = await sandbox.runCommand({
      cmd: "ls",
      args: ["-la", ".next"],
      cwd: "/vercel/sandbox",
    });
    console.log("   .next contents:");
    console.log((await lsNext.stdout()).split('\n').map(l => `      ${l}`).join('\n'));

    // Step 6: Create snapshot (this stops the sandbox)
    console.log("\n6️⃣  Creating snapshot...");
    const snapshot = await sandbox.snapshot();

    console.log("\n" + "=".repeat(60));
    console.log("✅ SNAPSHOT CREATED SUCCESSFULLY!");
    console.log("=".repeat(60));
    console.log(`\nSnapshot ID: ${snapshot.snapshotId}`);
    console.log(`\nAdd to .env.local:`);
    console.log(`NEXTJS_SNAPSHOT_ID=${snapshot.snapshotId}`);
    console.log("\n" + "=".repeat(60));

    // Save snapshot ID
    const snapshotInfo = `# Next.js Sandbox Snapshot
# Created: ${new Date().toISOString()}
# Expires: ~7 days from creation
#
# Contents:
# - Next.js 15 + React 19 + TypeScript
# - Tailwind CSS
# - shadcn/ui (initialized, add components with: npx shadcn@latest add <name>)
# - ESLint configured
# - Turbopack enabled
#
NEXTJS_SNAPSHOT_ID=${snapshot.snapshotId}
`;
    writeFileSync("scripts/snapshot-id.txt", snapshotInfo);
    console.log("\n📄 Snapshot info saved to scripts/snapshot-id.txt");

    // Also append to .env.local if it exists
    const envLocalPath = ".env.local";
    if (existsSync(envLocalPath)) {
      const envContent = readFileSync(envLocalPath, "utf-8");
      if (!envContent.includes("NEXTJS_SNAPSHOT_ID")) {
        appendFileSync(envLocalPath, `\n# Next.js Sandbox Snapshot\nNEXTJS_SNAPSHOT_ID=${snapshot.snapshotId}\n`);
        console.log("📄 Added NEXTJS_SNAPSHOT_ID to .env.local");
      } else {
        console.log("⚠️  NEXTJS_SNAPSHOT_ID already in .env.local - update manually if needed");
      }
    }

  } catch (error) {
    console.error("\n❌ Error:", error);
    try {
      await sandbox.stop();
    } catch {
      // Ignore cleanup errors
    }
    process.exit(1);
  }
}

main();
