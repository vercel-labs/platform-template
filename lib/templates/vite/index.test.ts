import { describe, test, expect, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { viteTemplate } from "./index";
import type { SetupProgress } from "../types";

describe("Vite template", () => {
  let sandbox: Sandbox;

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop().catch(() => {});
    }
  }, 10_000);

  test("setup completes and dev server is reachable via preview URL", async () => {
    sandbox = await Sandbox.create({
      timeout: 300_000,
      ports: [5173],
    });

    // Install bun first — same as setupSandbox does before template.setup()
    const bunInstall = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        "curl -fsSL https://bun.sh/install | bash && ln -sf /root/.bun/bin/bun /usr/local/bin/bun && ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx",
      ],
      sudo: true,
    });
    expect(bunInstall.exitCode).toBe(0);

    // Run the full setup generator, collecting progress stages
    const stages: SetupProgress[] = [];
    for await (const progress of viteTemplate.setup(sandbox)) {
      console.log(`[setup] ${progress.stage}: ${progress.message}`);
      stages.push(progress);
    }

    // Verify all expected stages were emitted
    const stageNames = stages.map((s) => s.stage);
    expect(stageNames).toContain("creating-app");
    expect(stageNames).toContain("installing-deps");
    expect(stageNames).toContain("configuring");
    expect(stageNames).toContain("ready");

    // Verify the project was scaffolded correctly (not nested)
    const pkgContent = await sandbox.readFileToBuffer({
      path: "/vercel/sandbox/package.json",
    });
    expect(pkgContent).not.toBeNull();
    const pkg = JSON.parse(pkgContent!.toString());
    expect(pkg.dependencies.react).toBeDefined();
    expect(pkg.scripts.dev).toBe("vite");

    // Verify essential files exist at the correct path
    const checkFiles = await sandbox.runCommand({
      cmd: "ls",
      args: [
        "/vercel/sandbox/index.html",
        "/vercel/sandbox/src/main.tsx",
        "/vercel/sandbox/src/App.tsx",
        "/vercel/sandbox/vite.config.ts",
      ],
    });
    expect(checkFiles.exitCode).toBe(0);

    // Verify the vite config has sandbox-friendly settings
    const viteContent = await sandbox.readFileToBuffer({
      path: "/vercel/sandbox/vite.config.ts",
    });
    expect(viteContent).not.toBeNull();
    const viteStr = viteContent!.toString();
    expect(viteStr).toContain("allowedHosts: true");
    expect(viteStr).toContain("host: true");
    expect(viteStr).toContain("tailwindcss");

    // Verify index.css has Tailwind import
    const cssContent = await sandbox.readFileToBuffer({
      path: "/vercel/sandbox/src/index.css",
    });
    expect(cssContent).not.toBeNull();
    expect(cssContent!.toString()).toContain("tailwindcss");

    // Verify sandbox.domain(5173) returns a valid URL
    const previewUrl = sandbox.domain(5173);
    expect(previewUrl).toMatch(/^https:\/\/.*\.vercel\.run$/);

    // Verify the dev server is reachable internally
    const curlResult = await sandbox.runCommand({
      cmd: "curl",
      args: [
        "-s", "-o", "/dev/null", "-w", "%{http_code}",
        "http://localhost:5173",
      ],
    });
    const statusCode = (await curlResult.stdout()).trim();
    expect(["200", "404"]).toContain(statusCode);

    // Verify the dev server is reachable via the external preview URL
    const maxWait = 30_000;
    const start = Date.now();
    let reachable = false;

    while (Date.now() - start < maxWait) {
      try {
        const resp = await fetch(previewUrl, {
          method: "HEAD",
          signal: AbortSignal.timeout(3_000),
        });
        if (resp.ok || resp.status === 404) {
          reachable = true;
          break;
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }

    expect(reachable).toBe(true);
  }, 300_000);
});
