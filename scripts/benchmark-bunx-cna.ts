/**
 * Benchmark bunx create-next-app vs writing files + bun install
 */

import { Sandbox } from "@vercel/sandbox";

const SANDBOX_BASE_PATH = "/vercel/sandbox";

async function benchmark() {
  console.log("🚀 Benchmarking bunx create-next-app...\n");

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

  // Install bun
  console.log("Installing bun...");
  t = Date.now();
  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "curl -fsSL https://bun.sh/install | bash"],
    sudo: true,
  });
  console.log(`Bun install: ${Date.now() - t}ms\n`);

  // bunx create-next-app
  console.log("Running bunx create-next-app...");
  t = Date.now();
  const cna = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `export BUN_INSTALL=/root/.bun && export PATH=$BUN_INSTALL/bin:$PATH && bunx create-next-app@latest ${SANDBOX_BASE_PATH} --yes --typescript --tailwind --eslint --app --src-dir --turbopack --no-import-alias`,
    ],
    cwd: "/",
    env: { CI: "true" },
    sudo: true,
  });
  console.log(`bunx create-next-app: ${Date.now() - t}ms`);
  console.log(`exit code: ${cna.exitCode}`);
  if (cna.exitCode !== 0) {
    console.log(`stdout: ${await cna.stdout()}`);
    console.log(`stderr: ${await cna.stderr()}`);
  }
  console.log();

  // Start dev server
  console.log("Starting dev server...");
  t = Date.now();
  sandbox
    .runCommand({
      cmd: "sh",
      args: [
        "-c",
        "export BUN_INSTALL=/root/.bun && export PATH=$BUN_INSTALL/bin:$PATH && bun run dev",
      ],
      cwd: SANDBOX_BASE_PATH,
      sudo: true,
      detached: true,
    })
    .catch(() => {});

  const previewUrl = sandbox.domain(3000);
  let ready = false;
  while (Date.now() - t < 30000) {
    try {
      const res = await fetch(previewUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok || res.status === 404) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(
    `Dev server: ${Date.now() - t}ms (${ready ? "ready" : "timeout"})\n`,
  );

  await sandbox.stop();
  console.log("Done!");
}

benchmark().catch(console.error);
