/**
 * Debug sandbox permissions
 */

import { Sandbox } from "@vercel/sandbox";

async function main() {
  const sandbox = await Sandbox.create({ timeout: 300_000 });
  console.log(`Sandbox: ${sandbox.sandboxId}\n`);

  console.log("=== Identity checks ===");

  const whoami = await sandbox.runCommand({ cmd: "whoami" });
  console.log(`Without sudo: ${(await whoami.stdout()).trim()}`);

  const whoamiSudo = await sandbox.runCommand({ cmd: "whoami", sudo: true });
  console.log(`With sudo: ${(await whoamiSudo.stdout()).trim()}`);

  console.log("\n=== /vercel/sandbox permissions ===");
  const ls = await sandbox.runCommand({
    cmd: "ls",
    args: ["-la", "/vercel/sandbox"],
    sudo: true,
  });
  console.log(await ls.stdout());

  console.log("=== Creating file with sudo ===");
  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "echo 'test' > /vercel/sandbox/test.txt"],
    sudo: true,
  });

  const lsAfter = await sandbox.runCommand({
    cmd: "ls",
    args: ["-la", "/vercel/sandbox/test.txt"],
    sudo: true,
  });
  console.log(await lsAfter.stdout());

  console.log("=== Reading without sudo ===");
  const cat = await sandbox.runCommand({
    cmd: "cat",
    args: ["/vercel/sandbox/test.txt"],
  });
  console.log(`Exit: ${cat.exitCode}, Content: ${(await cat.stdout()).trim()}`);

  console.log("=== Writing without sudo ===");
  const write = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "echo 'test2' > /vercel/sandbox/test2.txt"],
  });
  console.log(`Exit: ${write.exitCode}`);
  if (write.exitCode !== 0) {
    console.log(`stderr: ${await write.stderr()}`);
  }

  console.log("\n=== Parent directory ===");
  const lsParent = await sandbox.runCommand({
    cmd: "ls",
    args: ["-la", "/vercel/"],
    sudo: true,
  });
  console.log(await lsParent.stdout());

  await sandbox.stop();
}

main().catch(console.error);
