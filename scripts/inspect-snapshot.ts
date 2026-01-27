
import { Sandbox } from "@vercel/sandbox";

const SNAPSHOT_ID = process.env.NEXTJS_SNAPSHOT_ID!;

if (!SNAPSHOT_ID) {
  console.error("NEXTJS_SNAPSHOT_ID env var is required");
  process.exit(1);
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("SNAPSHOT INSPECTION");
  console.log("=".repeat(70));
  console.log(`Snapshot: ${SNAPSHOT_ID}\n`);

  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`Sandbox created: ${sandbox.sandboxId}\n`);

  try {
    console.log("📊 DISK USAGE:");
    console.log("-".repeat(50));
    const du = await sandbox.runCommand({
      cmd: "du",
      args: ["-sh", "/vercel/sandbox", "/root", "/usr/local"],
      cwd: "/",
    });
    console.log(await du.stdout());

    console.log("\n📁 /vercel/sandbox CONTENTS:");
    console.log("-".repeat(50));
    const lsSandbox = await sandbox.runCommand({
      cmd: "ls",
      args: ["-la"],
      cwd: "/vercel/sandbox",
    });
    console.log(await lsSandbox.stdout());

    console.log("\n📦 .next FOLDER:");
    console.log("-".repeat(50));
    const duNext = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "du -sh .next 2>/dev/null || echo 'No .next folder'"],
      cwd: "/vercel/sandbox",
    });
    console.log(await duNext.stdout());

    const lsNext = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "ls -la .next 2>/dev/null || echo 'No .next folder'"],
      cwd: "/vercel/sandbox",
    });
    console.log(await lsNext.stdout());

    console.log("\n⚡ TURBOPACK CACHE:");
    console.log("-".repeat(50));
    const duTurbo = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "du -sh .next/dev/cache/turbopack 2>/dev/null || echo 'No Turbopack cache'"],
      cwd: "/vercel/sandbox",
    });
    console.log(await duTurbo.stdout());

    console.log("\n📦 node_modules:");
    console.log("-".repeat(50));
    const duNodeModules = await sandbox.runCommand({
      cmd: "du",
      args: ["-sh", "node_modules"],
      cwd: "/vercel/sandbox",
    });
    console.log(await duNodeModules.stdout());

    console.log("\n🤖 INSTALLED CLI TOOLS:");
    console.log("-".repeat(50));

    const claude = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "which claude 2>/dev/null && claude --version 2>/dev/null | head -1 || echo 'Claude not found'"],
      cwd: "/vercel/sandbox",
    });
    console.log("Claude:", (await claude.stdout()).trim());

    const opencode = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "which opencode 2>/dev/null && opencode --version 2>/dev/null | head -1 || echo 'OpenCode not found'"],
      cwd: "/vercel/sandbox",
    });
    console.log("OpenCode:", (await opencode.stdout()).trim());

    const codex = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "which codex 2>/dev/null && codex --version 2>/dev/null | head -1 || echo 'Codex not found'"],
      cwd: "/vercel/sandbox",
    });
    console.log("Codex:", (await codex.stdout()).trim());

    console.log("\n📂 ~/.local (CLI installs):");
    console.log("-".repeat(50));
    const duLocal = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "du -sh ~/.local 2>/dev/null || echo 'No ~/.local'"],
      cwd: "/vercel/sandbox",
    });
    console.log(await duLocal.stdout());

    console.log("\n📦 Global npm packages:");
    console.log("-".repeat(50));
    const npmGlobal = await sandbox.runCommand({
      cmd: "npm",
      args: ["list", "-g", "--depth=0"],
      cwd: "/vercel/sandbox",
    });
    console.log(await npmGlobal.stdout());

    const duNpmGlobal = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "du -sh $(npm root -g) 2>/dev/null || echo 'Cannot determine'"],
      cwd: "/vercel/sandbox",
    });
    console.log("Global npm size:", (await duNpmGlobal.stdout()).trim());

    console.log("\n" + "=".repeat(70));
    console.log("SIZE BREAKDOWN:");
    console.log("=".repeat(70));
    const breakdown = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", `
        echo "Project (node_modules):"
        du -sh /vercel/sandbox/node_modules 2>/dev/null || echo "  N/A"
        echo ""
        echo ".next folder:"
        du -sh /vercel/sandbox/.next 2>/dev/null || echo "  N/A"
        echo ""
        echo "CLI tools (~/.local):"
        du -sh ~/.local 2>/dev/null || echo "  N/A"
        echo ""
        echo "Global npm:"
        du -sh $(npm root -g) 2>/dev/null || echo "  N/A"
        echo ""
        echo "TOTAL /vercel/sandbox:"
        du -sh /vercel/sandbox 2>/dev/null
      `],
      cwd: "/",
    });
    console.log(await breakdown.stdout());

  } finally {
    await sandbox.stop();
  }
}

main().catch(console.error);
