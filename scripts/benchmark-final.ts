/**
 * Final end-to-end benchmark of the new setup flow
 */

import { Sandbox } from "@vercel/sandbox";

const SANDBOX_BASE_PATH = "/vercel/sandbox";
const SANDBOX_DEV_PORT = 3000;
const BUN_PATH =
  "export BUN_INSTALL=/root/.bun && export PATH=$BUN_INSTALL/bin:$PATH";

const AGENT_INSTALL_COMMANDS: Record<string, string> = {
  claude: "curl -fsSL https://claude.ai/install.sh | bash",
  codex: `${BUN_PATH} && bun i -g @openai/codex`,
  opencode: "curl -fsSL https://opencode.ai/install | bash",
};

async function benchmark(agentId: string) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Testing with agent: ${agentId}`);
  console.log("=".repeat(50));

  const totalStart = Date.now();
  const times: Record<string, number> = {};

  // Create sandbox
  let t = Date.now();
  const sandbox = await Sandbox.create({
    ports: [SANDBOX_DEV_PORT],
    timeout: 600_000,
  });
  times["create_sandbox"] = Date.now() - t;
  console.log(`1. Create sandbox: ${times["create_sandbox"]}ms`);

  // Install bun
  t = Date.now();
  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "curl -fsSL https://bun.sh/install | bash"],
    sudo: true,
  });
  times["install_bun"] = Date.now() - t;
  console.log(`2. Install bun: ${times["install_bun"]}ms`);

  // bunx create-next-app
  t = Date.now();
  const createApp = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `${BUN_PATH} && bunx create-next-app@latest ${SANDBOX_BASE_PATH} --yes --typescript --tailwind --eslint --app --src-dir --turbopack --no-import-alias`,
    ],
    env: { CI: "true" },
    sudo: true,
  });
  times["create_next_app"] = Date.now() - t;
  console.log(
    `3. bunx create-next-app: ${times["create_next_app"]}ms (exit: ${createApp.exitCode})`,
  );

  // Start dev server + install agent in parallel
  t = Date.now();

  // Start dev server (detached)
  sandbox
    .runCommand({
      cmd: "sh",
      args: ["-c", `${BUN_PATH} && bun run dev`],
      cwd: SANDBOX_BASE_PATH,
      sudo: true,
      detached: true,
    })
    .catch(() => {});

  // Install agent
  const agentInstallCmd = AGENT_INSTALL_COMMANDS[agentId];
  const agentPromise = sandbox.runCommand({
    cmd: "sh",
    args: ["-c", agentInstallCmd],
    sudo: true,
  });

  // Wait for dev server
  const previewUrl = sandbox.domain(SANDBOX_DEV_PORT);
  const devServerReady = (async () => {
    const maxWait = 30000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const res = await fetch(previewUrl, {
          method: "HEAD",
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok || res.status === 404) return Date.now() - start;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    return -1;
  })();

  const [agentResult, devTime] = await Promise.all([
    agentPromise,
    devServerReady,
  ]);
  times["parallel_step"] = Date.now() - t;
  console.log(`4. Parallel (agent + dev server): ${times["parallel_step"]}ms`);
  console.log(`   - Agent install exit: ${agentResult.exitCode}`);
  console.log(`   - Dev server ready in: ${devTime}ms`);

  // Verify agent works
  const verifyCmd =
    agentId === "claude"
      ? "source ~/.bashrc 2>/dev/null; which claude"
      : agentId === "codex"
        ? "which codex"
        : "source ~/.bashrc 2>/dev/null; which opencode";

  const verify = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", verifyCmd],
    sudo: true,
  });
  console.log(
    `   - Agent binary: ${(await verify.stdout()).trim() || "NOT FOUND"}`,
  );

  const total = Date.now() - totalStart;
  console.log(`\nTOTAL: ${total}ms (~${(total / 1000).toFixed(1)}s)`);

  await sandbox.stop();
  return total;
}

async function main() {
  console.log("🚀 Final Setup Benchmark\n");

  const results: Record<string, number> = {};

  for (const agent of ["claude", "codex"]) {
    results[agent] = await benchmark(agent);
  }

  console.log("\n" + "=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50));
  for (const [agent, time] of Object.entries(results)) {
    console.log(`${agent}: ${(time / 1000).toFixed(1)}s`);
  }
}

main().catch(console.error);
