import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";

describe("Dev Server Auto-Start", () => {
  let sandbox: Sandbox;

  beforeAll(async () => {
    sandbox = await Sandbox.create({
      timeout: 120_000,
      ports: [3000],
    });
  }, 60000);

  afterAll(async () => {
    await sandbox.stop();
  }, 10000);

  test("should detect Next.js project from package.json", async () => {
    const packageJson = JSON.stringify({
      name: "test-app",
      scripts: { dev: "next dev" },
      dependencies: { next: "^15", react: "^19", "react-dom": "^19" },
    });

    await sandbox.writeFiles([
      {
        path: "/vercel/sandbox/package.json",
        content: Buffer.from(packageJson),
      },
    ]);

    const content = await sandbox.readFileToBuffer({
      path: "/vercel/sandbox/package.json",
    });

    expect(content).not.toBeNull();
    const pkg = JSON.parse(content!.toString());
    expect(pkg.scripts.dev).toBe("next dev");
    expect(pkg.dependencies.next).toBeDefined();
  });

  test("should check if node_modules exists", async () => {
    const checkResult = await sandbox.runCommand({
      cmd: "test",
      args: ["-d", "/vercel/sandbox/node_modules"],
      cwd: "/vercel/sandbox",
    });

    expect(checkResult.exitCode).toBe(1);
  });

  test("should install dependencies and start dev server", async () => {
    await sandbox.mkDir("/vercel/sandbox/app");

    const packageJson = JSON.stringify({
      name: "test-app",
      scripts: { dev: "next dev" },
      dependencies: { next: "^15", react: "^19", "react-dom": "^19" },
    });

    const pageContent = `export default function Page() { return <h1>Hello</h1>; }`;
    const layoutContent = `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`;

    await sandbox.writeFiles([
      {
        path: "/vercel/sandbox/package.json",
        content: Buffer.from(packageJson),
      },
      {
        path: "/vercel/sandbox/app/page.tsx",
        content: Buffer.from(pageContent),
      },
      {
        path: "/vercel/sandbox/app/layout.tsx",
        content: Buffer.from(layoutContent),
      },
    ]);

    console.log("Installing dependencies...");
    const installResult = await sandbox.runCommand({
      cmd: "npm",
      args: ["install"],
      cwd: "/vercel/sandbox",
    });

    const installOutput = await installResult.stdout();
    console.log("Install output:", installOutput.slice(0, 500));

    expect(installResult.exitCode).toBe(0);

    const checkResult = await sandbox.runCommand({
      cmd: "test",
      args: ["-d", "/vercel/sandbox/node_modules"],
      cwd: "/vercel/sandbox",
    });
    expect(checkResult.exitCode).toBe(0);

    console.log("Starting dev server...");
    await sandbox.runCommand({
      cmd: "npm",
      args: ["run", "dev"],
      cwd: "/vercel/sandbox",
      detached: true,
    });

    await new Promise((r) => setTimeout(r, 5000));

    const curlResult = await sandbox.runCommand({
      cmd: "curl",
      args: [
        "-s",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "http://localhost:3000",
      ],
      cwd: "/vercel/sandbox",
    });

    const statusCode = await curlResult.stdout();
    console.log("Server status code:", statusCode);

    expect(["200", "500", "404"]).toContain(statusCode.trim());
  }, 120000);
});
