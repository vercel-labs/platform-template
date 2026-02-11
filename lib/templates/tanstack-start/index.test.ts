import { describe, test, expect, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { tanstackStartTemplate } from "./index";
import type { SetupProgress } from "../types";

describe("TanStack Start template", () => {
  let sandbox: Sandbox;

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop().catch(() => {});
    }
  }, 10000);

  test("setup completes without errors", async () => {
    sandbox = await Sandbox.create({
      timeout: 300_000,
      ports: [3000],
    });

    // Run the full setup generator, collecting progress stages
    const stages: SetupProgress[] = [];
    for await (const progress of tanstackStartTemplate.setup(sandbox)) {
      console.log(`[setup] ${progress.stage}: ${progress.message}`);
      stages.push(progress);
    }

    // Verify all expected stages were emitted
    const stageNames = stages.map((s) => s.stage);
    expect(stageNames).toContain("creating-app");
    expect(stageNames).toContain("installing-deps");
    expect(stageNames).toContain("configuring");
    expect(stageNames).toContain("ready");

    // Verify demo files were removed
    const checkDemoFiles = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        "ls /vercel/sandbox/src/routes/posts.tsx /vercel/sandbox/src/routes/users.tsx /vercel/sandbox/src/routes/deferred.tsx 2>&1 || true",
      ],
    });
    const output = await checkDemoFiles.stdout();
    expect(output).toContain("No such file");

    // Verify demo utils were removed
    const checkDemoUtils = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        "ls /vercel/sandbox/src/utils/posts.tsx /vercel/sandbox/src/utils/users.tsx 2>&1 || true",
      ],
    });
    const utilsOutput = await checkDemoUtils.stdout();
    expect(utilsOutput).toContain("No such file");

    // Verify essential files exist
    const checkFiles = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        "ls /vercel/sandbox/src/routes/__root.tsx /vercel/sandbox/src/routes/index.tsx /vercel/sandbox/vite.config.ts /vercel/sandbox/package.json",
      ],
    });
    expect(checkFiles.exitCode).toBe(0);

    // Verify __root.tsx is minimal (no devtools, no demo nav links)
    const rootContent = await sandbox.readFileToBuffer({
      path: "/vercel/sandbox/src/routes/__root.tsx",
    });
    expect(rootContent).not.toBeNull();
    const rootStr = rootContent!.toString();
    expect(rootStr).not.toContain("TanStackRouterDevtools");
    expect(rootStr).not.toContain("/posts");
    expect(rootStr).not.toContain("/users");
    expect(rootStr).not.toContain("Deferred");
    expect(rootStr).not.toContain("Pathless");
    expect(rootStr).toContain("createRootRoute");
    expect(rootStr).toContain("<Outlet />");
    expect(rootStr).toContain("<Scripts />");

    // Verify index.tsx is our minimal version
    const indexContent = await sandbox.readFileToBuffer({
      path: "/vercel/sandbox/src/routes/index.tsx",
    });
    expect(indexContent).not.toBeNull();
    const indexStr = indexContent!.toString();
    expect(indexStr).toContain("Hello World");
    expect(indexStr).toContain("createFileRoute");

    // Verify vite config has sandbox-friendly settings
    const viteContent = await sandbox.readFileToBuffer({
      path: "/vercel/sandbox/vite.config.ts",
    });
    expect(viteContent).not.toBeNull();
    const viteStr = viteContent!.toString();
    expect(viteStr).toContain("allowedHosts: true");
    expect(viteStr).toContain("host: true");
    expect(viteStr).toContain("tailwindcss");

    // Verify only minimal route files remain (no demo routes)
    const routeFiles = await sandbox.runCommand({
      cmd: "ls",
      args: ["/vercel/sandbox/src/routes/"],
    });
    const routeList = (await routeFiles.stdout()).trim().split("\n").sort();
    expect(routeList).toEqual(["__root.tsx", "index.tsx"]);
  }, 300_000);
});
