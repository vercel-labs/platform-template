/**
 * Benchmark agent CLI installation times
 */

import { Sandbox } from "@vercel/sandbox";

async function benchmark() {
  console.log("🚀 Benchmarking agent CLI installs...\n");

  const sandbox = await Sandbox.create({
    ports: [3000],
    timeout: 600_000,
  });
  console.log(`Sandbox: ${sandbox.sandboxId}\n`);

  // Warm up
  console.log("Warming up...");
  let t = Date.now();
  await sandbox.runCommand({ cmd: "echo", args: ["warm"], sudo: true });
  console.log(`Warmup: ${Date.now() - t}ms\n`);

  // Claude CLI
  console.log("Installing Claude CLI...");
  t = Date.now();
  const claude = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
    sudo: true,
  });
  console.log(`Claude CLI: ${Date.now() - t}ms (exit: ${claude.exitCode})`);

  // Verify claude works
  const claudeCheck = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      "source ~/.bashrc 2>/dev/null; which claude && claude --version",
    ],
    sudo: true,
  });
  console.log(`Claude check: ${await claudeCheck.stdout()}`);
  console.log();

  // Codex CLI
  console.log("Installing Codex CLI...");
  t = Date.now();
  const codex = await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "-g", "@openai/codex"],
    sudo: true,
  });
  console.log(`Codex CLI (npm): ${Date.now() - t}ms (exit: ${codex.exitCode})`);

  // Verify codex works
  const codexCheck = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "which codex && codex --version"],
    sudo: true,
  });
  console.log(`Codex check: ${await codexCheck.stdout()}`);
  console.log();

  // Try codex with bun
  console.log("Installing bun first...");
  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "curl -fsSL https://bun.sh/install | bash"],
    sudo: true,
  });

  console.log("Installing Codex CLI with bun...");
  t = Date.now();
  const codexBun = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      "export BUN_INSTALL=/root/.bun && export PATH=$BUN_INSTALL/bin:$PATH && bun install -g @openai/codex",
    ],
    sudo: true,
  });
  console.log(
    `Codex CLI (bun): ${Date.now() - t}ms (exit: ${codexBun.exitCode})`,
  );
  if (codexBun.exitCode !== 0) {
    console.log(`stderr: ${await codexBun.stderr()}`);
  }

  await sandbox.stop();
  console.log("\nDone!");
}

benchmark().catch(console.error);
