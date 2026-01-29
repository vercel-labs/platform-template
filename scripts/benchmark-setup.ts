/**
 * Benchmark sandbox setup to find where time is spent
 */

import { Sandbox } from "@vercel/sandbox";

const SANDBOX_BASE_PATH = "/vercel/sandbox";

async function benchmark() {
  console.log("🚀 Benchmarking sandbox setup...\n");

  const times: Record<string, number> = {};
  const start = Date.now();

  // Step 1: Create sandbox
  console.log("1. Creating blank sandbox...");
  const t1 = Date.now();
  const sandbox = await Sandbox.create({
    ports: [3000],
    timeout: 600_000,
  });
  times["create_sandbox"] = Date.now() - t1;
  console.log(
    `   ✓ ${times["create_sandbox"]}ms - Sandbox: ${sandbox.sandboxId}\n`,
  );

  // Step 2: First command (triggers cold start)
  console.log("2. First command (cold start)...");
  const t2 = Date.now();
  const warmup = await sandbox.runCommand({
    cmd: "echo",
    args: ["hello"],
    sudo: true,
  });
  times["cold_start"] = Date.now() - t2;
  console.log(`   ✓ ${times["cold_start"]}ms - Cold start complete\n`);

  // Step 3: create-next-app
  console.log("3. Running create-next-app...");
  const t3 = Date.now();
  const createNextjs = await sandbox.runCommand({
    cmd: "npx",
    args: [
      "-y",
      "create-next-app@latest",
      SANDBOX_BASE_PATH,
      "--yes",
      "--typescript",
      "--tailwind",
      "--eslint",
      "--app",
      "--src-dir",
      "--turbopack",
      "--no-import-alias",
    ],
    cwd: "/",
    env: { CI: "true" },
    sudo: true,
  });
  times["create_next_app"] = Date.now() - t3;

  if (createNextjs.exitCode !== 0) {
    console.log(`   ✗ Failed: ${await createNextjs.stderr()}`);
  } else {
    console.log(`   ✓ ${times["create_next_app"]}ms - Next.js created\n`);
  }

  // Step 4: shadcn init
  console.log("4. Running shadcn init...");
  const t4 = Date.now();
  const shadcn = await sandbox.runCommand({
    cmd: "npx",
    args: ["shadcn@latest", "init", "-y", "-d"],
    cwd: SANDBOX_BASE_PATH,
    sudo: true,
  });
  times["shadcn_init"] = Date.now() - t4;
  console.log(`   ✓ ${times["shadcn_init"]}ms - shadcn initialized\n`);

  // Step 5: Install claude CLI
  console.log("5. Installing Claude CLI...");
  const t5 = Date.now();
  const claude = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
    cwd: SANDBOX_BASE_PATH,
    sudo: true,
  });
  times["claude_install"] = Date.now() - t5;
  console.log(`   ✓ ${times["claude_install"]}ms - Claude installed\n`);

  // Step 6: Start dev server
  console.log("6. Starting dev server...");
  const t6 = Date.now();
  sandbox
    .runCommand({
      cmd: "npm",
      args: ["run", "dev"],
      cwd: SANDBOX_BASE_PATH,
      sudo: true,
      detached: true,
    })
    .catch(() => {});

  // Wait for server
  const previewUrl = sandbox.domain(3000);
  let serverReady = false;
  while (Date.now() - t6 < 30000) {
    try {
      const response = await fetch(previewUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok || response.status === 404) {
        serverReady = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  times["dev_server"] = Date.now() - t6;
  console.log(
    `   ✓ ${times["dev_server"]}ms - Dev server ${serverReady ? "ready" : "timeout"}\n`,
  );

  // Summary
  const total = Date.now() - start;
  console.log("=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50));
  console.log(
    `Create sandbox:    ${times["create_sandbox"].toString().padStart(6)}ms`,
  );
  console.log(
    `Cold start:        ${times["cold_start"].toString().padStart(6)}ms`,
  );
  console.log(
    `create-next-app:   ${times["create_next_app"].toString().padStart(6)}ms`,
  );
  console.log(
    `shadcn init:       ${times["shadcn_init"].toString().padStart(6)}ms`,
  );
  console.log(
    `Claude install:    ${times["claude_install"].toString().padStart(6)}ms`,
  );
  console.log(
    `Dev server ready:  ${times["dev_server"].toString().padStart(6)}ms`,
  );
  console.log("-".repeat(50));
  console.log(`TOTAL:             ${total.toString().padStart(6)}ms`);
  console.log("=".repeat(50));

  // Cleanup
  await sandbox.stop();
}

benchmark().catch(console.error);
