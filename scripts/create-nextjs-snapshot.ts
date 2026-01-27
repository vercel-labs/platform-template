
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
    console.log("1️⃣  Running create-next-app...");
    
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
    
    const verifyLs = await sandbox.runCommand({
      cmd: "ls",
      args: ["-la"],
      cwd: "/vercel/sandbox",
    });
    console.log("   Files after setup:");
    console.log(await verifyLs.stdout());
    
    const pkgCheck = await sandbox.readFileToBuffer({ path: "/vercel/sandbox/package.json" });
    if (!pkgCheck) {
      throw new Error("package.json not found!");
    }
    console.log("   ✅ Next.js app created\n");

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

    console.log("4️⃣b Installing AI coding agents...\n");

    console.log("   📦 Installing Claude Code...");
    const claudeInstall = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
      cwd: "/vercel/sandbox",
    });
    const claudeStdout = await claudeInstall.stdout();
    if (claudeInstall.exitCode === 0) {
      console.log("   ✅ Claude Code installed");
    } else {
      console.log("   ⚠️  Claude Code install had issues:", await claudeInstall.stderr());
    }

    const claudeVersion = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "source ~/.bashrc 2>/dev/null; claude --version"],
      cwd: "/vercel/sandbox",
    });
    console.log(`   Claude version: ${(await claudeVersion.stdout()).trim()}`);

    console.log("\n   📦 Installing OpenCode...");
    const opencodeInstall = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "curl -fsSL https://opencode.ai/install | bash"],
      cwd: "/vercel/sandbox",
    });
    if (opencodeInstall.exitCode === 0) {
      console.log("   ✅ OpenCode installed");
    } else {
      console.log("   ⚠️  OpenCode install had issues:", await opencodeInstall.stderr());
    }

    const opencodeVersion = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "source ~/.bashrc 2>/dev/null; opencode --version 2>/dev/null || echo 'version check skipped'"],
      cwd: "/vercel/sandbox",
    });
    console.log(`   OpenCode version: ${(await opencodeVersion.stdout()).trim()}`);

    console.log("\n   📦 Installing Codex...");
    const codexInstall = await sandbox.runCommand({
      cmd: "npm",
      args: ["install", "-g", "@openai/codex"],
      cwd: "/vercel/sandbox",
    });
    if (codexInstall.exitCode === 0) {
      console.log("   ✅ Codex installed");
    } else {
      console.log("   ⚠️  Codex install had issues:", await codexInstall.stderr());
    }

    const codexVersion = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "codex --version 2>/dev/null || echo 'version check skipped'"],
      cwd: "/vercel/sandbox",
    });
    console.log(`   Codex version: ${(await codexVersion.stdout()).trim()}`);

    console.log("\n   ✅ AI coding agents installed\n");

    console.log("5️⃣  Starting dev server to build Turbopack cache...\n");
    
    sandbox.runCommand({
      cmd: "npm",
      args: ["run", "dev"],
      cwd: "/vercel/sandbox",
      detached: true,
    }).catch(() => {});
    
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
    
    console.log("   Waiting for Turbopack cache to flush (5s)...");
    await new Promise(r => setTimeout(r, 5000));
    
    console.log("   Syncing filesystem...");
    await sandbox.runCommand({
      cmd: "sync",
      cwd: "/vercel/sandbox",
      sudo: true,
    });
    
    const cacheSize = await sandbox.runCommand({
      cmd: "du",
      args: ["-sh", ".next/dev/cache/turbopack"],
      cwd: "/vercel/sandbox",
    });
    const cacheSizeStr = (await cacheSize.stdout()).trim();
    console.log(`   Turbopack cache size: ${cacheSizeStr.split('\t')[0]}`);
    
    const lsNext = await sandbox.runCommand({
      cmd: "ls",
      args: ["-la", ".next"],
      cwd: "/vercel/sandbox",
    });
    console.log("   .next contents:");
    console.log((await lsNext.stdout()).split('\n').map(l => `      ${l}`).join('\n'));

    const nextVersionResult = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "cat package.json | grep '\"next\":' | head -1"],
      cwd: "/vercel/sandbox",
    });
    const nextVersionLine = (await nextVersionResult.stdout()).trim();
    console.log(`   Next.js version: ${nextVersionLine}`);

    console.log("\n6️⃣  Creating snapshot...");
    const snapshot = await sandbox.snapshot();

    console.log("\n" + "=".repeat(60));
    console.log("✅ SNAPSHOT CREATED SUCCESSFULLY!");
    console.log("=".repeat(60));
    console.log(`\nSnapshot ID: ${snapshot.snapshotId}`);
    console.log(`\nAdd to .env.local:`);
    console.log(`NEXTJS_SNAPSHOT_ID=${snapshot.snapshotId}`);
    console.log("\n" + "=".repeat(60));

    const snapshotInfo = `# Next.js Sandbox Snapshot with AI Coding Agents
# Created: ${new Date().toISOString()}
# Expires: ~7 days from creation
#
# Contents:
# - Next.js (latest) + React 19 + TypeScript ${nextVersionLine ? `(${nextVersionLine})` : ''}
# - Tailwind CSS
# - shadcn/ui (initialized, add components with: npx shadcn@latest add <name>)
# - ESLint configured
# - Turbopack enabled with filesystem cache
#
# AI Coding Agents:
# - Claude Code (claude) - Anthropic
# - OpenCode (opencode) - Open source
# - Codex (codex) - OpenAI
#
NEXTJS_SNAPSHOT_ID=${snapshot.snapshotId}
`;
    writeFileSync("scripts/snapshot-id.txt", snapshotInfo);
    console.log("\n📄 Snapshot info saved to scripts/snapshot-id.txt");

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
    }
    process.exit(1);
  }
}

main();
