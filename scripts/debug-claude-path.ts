/**
 * Debug where claude CLI gets installed
 */

import { Sandbox } from "@vercel/sandbox";

async function main() {
  const sandbox = await Sandbox.create({ timeout: 300_000 });
  console.log(`Sandbox: ${sandbox.sandboxId}\n`);

  await sandbox.runCommand({ cmd: "echo", args: ["warm"], sudo: true });

  console.log("Installing claude...");
  const install = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
    sudo: true,
  });
  console.log(`Exit: ${install.exitCode}`);
  console.log(`stdout: ${await install.stdout()}`);
  console.log(`stderr: ${await install.stderr()}`);

  console.log("\nChecking locations...");

  const checks = [
    "which claude",
    "ls -la ~/.claude/local/bin/ 2>/dev/null || echo 'not found'",
    "ls -la /root/.claude/local/bin/ 2>/dev/null || echo 'not found'",
    "cat ~/.bashrc | grep -i claude || echo 'no claude in bashrc'",
    "cat /root/.bashrc | grep -i claude || echo 'no claude in root bashrc'",
    "source ~/.bashrc 2>/dev/null; which claude || echo 'not in path after source'",
    "export PATH=$PATH:~/.claude/local/bin; which claude || echo 'still not found'",
    "/root/.claude/local/bin/claude --version 2>/dev/null || echo 'direct path failed'",
  ];

  for (const cmd of checks) {
    const result = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", cmd],
      sudo: true,
    });
    console.log(`\n$ ${cmd}`);
    console.log(await result.stdout());
  }

  await sandbox.stop();
}

main().catch(console.error);
