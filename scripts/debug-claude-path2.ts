/**
 * Debug where claude CLI gets installed - part 2
 */

import { Sandbox } from "@vercel/sandbox";

async function main() {
  const sandbox = await Sandbox.create({ timeout: 300_000 });
  console.log(`Sandbox: ${sandbox.sandboxId}\n`);

  // Warm up
  await sandbox.runCommand({ cmd: "echo", args: ["warm"], sudo: true });

  // Install claude
  console.log("Installing claude...");
  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
    sudo: true,
  });

  // Check ~/.local/bin
  console.log("\nChecking ~/.local/bin...");
  const checks = [
    "ls -la ~/.local/bin/ 2>/dev/null || echo 'not found'",
    "ls -la /root/.local/bin/ 2>/dev/null || echo 'not found'",
    "~/.local/bin/claude --version 2>/dev/null || echo 'failed'",
    "/root/.local/bin/claude --version 2>/dev/null || echo 'failed'",
    "export PATH=$PATH:/root/.local/bin && claude --version",
  ];

  for (const cmd of checks) {
    const result = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", cmd],
      sudo: true,
    });
    console.log(`\n$ ${cmd}`);
    console.log(`stdout: ${await result.stdout()}`);
    if (result.exitCode !== 0) {
      console.log(`stderr: ${await result.stderr()}`);
    }
  }

  await sandbox.stop();
}

main().catch(console.error);
