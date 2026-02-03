/**
 * Detailed benchmark to find why create-next-app is slow
 */

import { Sandbox } from "@vercel/sandbox";

async function benchmark() {
  console.log("🚀 Detailed benchmark...\n");

  const sandbox = await Sandbox.create({
    ports: [3000],
    timeout: 600_000,
  });
  console.log(`Sandbox: ${sandbox.sandboxId}\n`);

  console.log("Warming up...");
  await sandbox.runCommand({ cmd: "echo", args: ["warm"], sudo: true });
  console.log("Warmed up\n");

  console.log("Checking versions...");
  const nodeV = await sandbox.runCommand({
    cmd: "node",
    args: ["-v"],
    sudo: true,
  });
  const npmV = await sandbox.runCommand({
    cmd: "npm",
    args: ["-v"],
    sudo: true,
  });
  console.log(`Node: ${(await nodeV.stdout()).trim()}`);
  console.log(`NPM: ${(await npmV.stdout()).trim()}\n`);

  console.log("Checking disk...");
  const df = await sandbox.runCommand({
    cmd: "df",
    args: ["-h", "/"],
    sudo: true,
  });
  console.log(await df.stdout());

  console.log("Testing simple npm install (just next)...");
  let t = Date.now();
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      "mkdir -p /tmp/test && cd /tmp/test && npm init -y && npm install next",
    ],
    sudo: true,
  });
  console.log(`Simple npm install: ${Date.now() - t}ms\n`);

  console.log("Testing create-next-app with --use-npm...");
  t = Date.now();
  const cna = await sandbox.runCommand({
    cmd: "npx",
    args: [
      "-y",
      "create-next-app@latest",
      "/tmp/app1",
      "--yes",
      "--typescript",
      "--tailwind",
      "--eslint",
      "--app",
      "--src-dir",
      "--turbopack",
      "--no-import-alias",
      "--use-npm",
    ],
    cwd: "/tmp",
    env: { CI: "true" },
    sudo: true,
  });
  console.log(`create-next-app (npm): ${Date.now() - t}ms`);
  if (cna.exitCode !== 0) {
    console.log(`Error: ${await cna.stderr()}`);
  }
  console.log();

  console.log("Testing minimal create-next-app...");
  t = Date.now();
  const cna2 = await sandbox.runCommand({
    cmd: "npx",
    args: ["-y", "create-next-app@latest", "/tmp/app2", "--yes", "--use-npm"],
    cwd: "/tmp",
    env: { CI: "true" },
    sudo: true,
  });
  console.log(`create-next-app (minimal): ${Date.now() - t}ms`);
  if (cna2.exitCode !== 0) {
    console.log(`Error: ${await cna2.stderr()}`);
  }
  console.log();

  console.log("NPM cache info...");
  const cache = await sandbox.runCommand({
    cmd: "npm",
    args: ["cache", "ls"],
    sudo: true,
  });
  const cacheDir = await sandbox.runCommand({
    cmd: "npm",
    args: ["config", "get", "cache"],
    sudo: true,
  });
  console.log(`Cache dir: ${(await cacheDir.stdout()).trim()}`);

  await sandbox.stop();
}

benchmark().catch(console.error);
