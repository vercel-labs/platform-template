import { Sandbox } from "@vercel/sandbox";

const SNAPSHOT_ID = "snap_X1Uz65k4dG7MTcGld4ZQdcMHpqeW";

async function main() {
  console.log("=".repeat(70));
  console.log("SANDBOX STATUS INVESTIGATION");
  console.log("=".repeat(70));

  console.log("\n1️⃣  Creating sandbox and checking status...");

  const createStart = Date.now();
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`   Create returned in: ${Date.now() - createStart}ms`);
  console.log(`   Sandbox ID: ${sandbox.sandboxId}`);
  console.log(`   Status: ${sandbox.status}`);
  console.log(`   Created at: ${sandbox.createdAt}`);

  console.log("\n2️⃣  Polling status while doing operations...");

  console.log(`   Status before operation: ${sandbox.status}`);

  const opStart = Date.now();
  const readPromise = sandbox.readFileToBuffer({
    path: "/vercel/sandbox/package.json",
  });

  const statusPoll = setInterval(() => {
    console.log(`   Status at ${Date.now() - opStart}ms: ${sandbox.status}`);
  }, 1000);

  await readPromise;
  clearInterval(statusPoll);
  console.log(`   Operation completed in: ${Date.now() - opStart}ms`);
  console.log(`   Final status: ${sandbox.status}`);

  console.log("\n3️⃣  Testing domain access...");

  const sandbox2 = await Sandbox.create({
    source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
    ports: [3000],
    timeout: 300_000,
    resources: { vcpus: 2 },
  });
  console.log(`   Created sandbox2: ${sandbox2.sandboxId}`);

  const domain = sandbox2.domain(3000);
  console.log(`   Domain: ${domain}`);

  const fetchStart = Date.now();
  try {
    const res = await fetch(domain, {
      method: "HEAD",
      signal: AbortSignal.timeout(15000),
    });
    console.log(
      `   Domain fetch: ${Date.now() - fetchStart}ms (status: ${res.status})`,
    );
  } catch (e: any) {
    console.log(
      `   Domain fetch: ${Date.now() - fetchStart}ms (error: ${e.message})`,
    );
  }

  const cmdStart = Date.now();
  await sandbox2.runCommand({
    cmd: "echo",
    args: ["hello"],
    cwd: "/vercel/sandbox",
  });
  console.log(
    `   First command after domain fetch: ${Date.now() - cmdStart}ms`,
  );

  await sandbox.stop();
  await sandbox2.stop();

  console.log("\n" + "=".repeat(70));
}

main().catch(console.error);
