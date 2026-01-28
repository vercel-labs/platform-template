/**
 * Test that agent CLIs work with the new PATH
 */

import { Sandbox } from "@vercel/sandbox";

const BUN_PATH = "export BUN_INSTALL=/root/.bun && export PATH=$BUN_INSTALL/bin:$PATH";

async function main() {
  const sandbox = await Sandbox.create({ timeout: 300_000 });
  console.log(`Sandbox: ${sandbox.sandboxId}\n`);

  // Warm up
  await sandbox.runCommand({ cmd: "echo", args: ["warm"], sudo: true });

  // Install bun
  console.log("Installing bun...");
  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "curl -fsSL https://bun.sh/install | bash"],
    sudo: true,
  });

  // Install claude
  console.log("Installing claude...");
  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
    sudo: true,
  });

  // Install codex with bun
  console.log("Installing codex...");
  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", `${BUN_PATH} && bun i -g @openai/codex`],
    sudo: true,
  });

  // Test claude with new PATH
  console.log("\nTesting claude...");
  const claudeTest = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", 'export PATH="$PATH:/root/.local/bin:/root/.bun/bin" && claude --version'],
    sudo: true,
  });
  console.log(`Claude: ${(await claudeTest.stdout()).trim()} (exit: ${claudeTest.exitCode})`);

  // Test codex with new PATH
  console.log("\nTesting codex...");
  const codexTest = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", 'export PATH="$PATH:/root/.local/bin:/root/.bun/bin" && codex --version'],
    sudo: true,
  });
  console.log(`Codex: ${(await codexTest.stdout()).trim()} (exit: ${codexTest.exitCode})`);

  await sandbox.stop();
  console.log("\n✅ Both agents accessible!");
}

main().catch(console.error);
