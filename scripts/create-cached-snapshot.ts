import { Sandbox } from "@vercel/sandbox";
import { writeFileSync } from "fs";

async function main() {
  console.log("🚀 Creating CACHED snapshot (with .next, no AI agents)...\n");

  const sandbox = await Sandbox.create({
    timeout: 300_000,
    ports: [3000],
    runtime: "node24",
    resources: { vcpus: 2 },
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

    if (createApp.exitCode !== 0) {
      throw new Error(`create-next-app failed: ${await createApp.stderr()}`);
    }

    await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "cp -r /tmp/app/. /vercel/sandbox/"],
      cwd: "/vercel/sandbox",
    });
    console.log("   ✅ Next.js app created\n");

    console.log("2️⃣  Configuring Next.js with Turbopack cache...");
    const nextConfig = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
};

export default nextConfig;
`;
    await sandbox.writeFiles([
      {
        path: "/vercel/sandbox/next.config.ts",
        content: Buffer.from(nextConfig),
      },
    ]);
    console.log("   ✅ next.config.ts updated\n");

    console.log("3️⃣  Setting up minimal starter page...");
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
      {
        path: "/vercel/sandbox/src/app/page.tsx",
        content: Buffer.from(minimalPage),
      },
    ]);
    console.log("   ✅ Starter page created\n");

    console.log("4️⃣  Building Turbopack cache...");

    sandbox
      .runCommand({
        cmd: "npm",
        args: ["run", "dev"],
        cwd: "/vercel/sandbox",
        detached: true,
      })
      .catch(() => {});

    console.log("   Waiting for compilation...");
    for (let i = 0; i < 60; i++) {
      const curl = await sandbox.runCommand({
        cmd: "curl",
        args: [
          "-s",
          "-o",
          "/dev/null",
          "-w",
          "%{http_code}",
          "http://localhost:3000",
        ],
        cwd: "/vercel/sandbox",
      });
      if ((await curl.stdout()).trim() === "200") {
        console.log("   ✅ Server compiled");
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log("   Waiting for cache flush (5s)...");
    await new Promise((r) => setTimeout(r, 5000));

    await sandbox.runCommand({
      cmd: "sync",
      cwd: "/vercel/sandbox",
      sudo: true,
    });

    console.log("\n📊 Size check:");
    const du1 = await sandbox.runCommand({
      cmd: "du",
      args: ["-sh", "/vercel/sandbox"],
      cwd: "/",
    });
    console.log("   Total: " + (await du1.stdout()).trim());

    const du2 = await sandbox.runCommand({
      cmd: "du",
      args: ["-sh", ".next"],
      cwd: "/vercel/sandbox",
    });
    console.log("   .next: " + (await du2.stdout()).trim());

    console.log("\n5️⃣  Creating snapshot...");
    const snapshot = await sandbox.snapshot();

    console.log("\n" + "=".repeat(60));
    console.log("✅ CACHED SNAPSHOT CREATED!");
    console.log("=".repeat(60));
    console.log(`\nSnapshot ID: ${snapshot.snapshotId}`);
    console.log(`\nContents: Next.js + Tailwind + .next cache (NO AI agents)`);
    console.log("\n" + "=".repeat(60));

    writeFileSync(
      "scripts/cached-snapshot-id.txt",
      `CACHED_SNAPSHOT_ID=${snapshot.snapshotId}\n`,
    );
    console.log("\n📄 Saved to scripts/cached-snapshot-id.txt\n");
  } catch (error) {
    console.error("\n❌ Error:", error);
    try {
      await sandbox.stop();
    } catch {}
    process.exit(1);
  }
}

main();
