import { describe, test, expect, beforeEach } from "vitest";
import { createSandboxStore } from "../sandbox-store";
import type { SandboxStoreApi } from "../sandbox-store";

let store: SandboxStoreApi;

describe("SandboxStore", () => {
  beforeEach(() => {
    store = createSandboxStore();
  });

  describe("sandbox state", () => {
    test("setSandbox initializes sandbox with ID and status", () => {
      store.getState().setSandbox("sbx-123", "ready");

      const state = store.getState();
      expect(state.sandboxId).toBe("sbx-123");
      expect(state.status).toBe("ready");
      expect(state.files).toEqual([]);
      expect(state.commands).toEqual([]);
    });

    test("setPreviewUrl updates preview URL", () => {
      store.getState().setPreviewUrl("https://preview.vercel.app");

      expect(store.getState().previewUrl).toBe(
        "https://preview.vercel.app",
      );
    });

    test("setStatus updates status", () => {
      store.getState().setStatus("creating");
      expect(store.getState().status).toBe("creating");

      store.getState().setStatus("ready");
      expect(store.getState().status).toBe("ready");
    });
  });

  describe("file management", () => {
    test("addFile adds a file path", () => {
      store.getState().addFile("/vercel/sandbox/index.ts");

      expect(store.getState().files).toEqual([
        "/vercel/sandbox/index.ts",
      ]);
    });

    test("addFile deduplicates paths", () => {
      store.getState().addFile("/vercel/sandbox/index.ts");
      store.getState().addFile("/vercel/sandbox/index.ts");

      expect(store.getState().files).toEqual([
        "/vercel/sandbox/index.ts",
      ]);
    });

    test("addFile sorts paths", () => {
      store.getState().addFile("/vercel/sandbox/z.ts");
      store.getState().addFile("/vercel/sandbox/a.ts");
      store.getState().addFile("/vercel/sandbox/m.ts");

      expect(store.getState().files).toEqual([
        "/vercel/sandbox/a.ts",
        "/vercel/sandbox/m.ts",
        "/vercel/sandbox/z.ts",
      ]);
    });

    test("addFiles adds multiple files", () => {
      store.getState().addFiles([
        "/vercel/sandbox/index.ts",
        "/vercel/sandbox/app.tsx",
        "/vercel/sandbox/styles.css",
      ]);

      expect(store.getState().files).toHaveLength(3);
    });

    test("addFiles deduplicates", () => {
      store.getState().addFile("/vercel/sandbox/index.ts");
      store.getState().addFiles(["/vercel/sandbox/index.ts", "/vercel/sandbox/app.tsx"]);

      expect(store.getState().files).toHaveLength(2);
    });
  });

  describe("command management", () => {
    test("addCommand adds a new command", () => {
      store.getState().addCommand({
        cmdId: "cmd-1",
        command: "npm",
        args: ["install"],
      });

      const commands = store.getState().commands;
      expect(commands).toHaveLength(1);
      expect(commands[0].cmdId).toBe("cmd-1");
      expect(commands[0].command).toBe("npm");
      expect(commands[0].args).toEqual(["install"]);
      expect(commands[0].logs).toEqual([]);
      expect(commands[0].startedAt).toBeGreaterThan(0);
    });

    test("addCommand does not duplicate", () => {
      store.getState().addCommand({ cmdId: "cmd-1", command: "npm" });
      store.getState().addCommand({ cmdId: "cmd-1", command: "npm" });

      expect(store.getState().commands).toHaveLength(1);
    });

    test("addCommandLog appends log to command", () => {
      store.getState().addCommand({ cmdId: "cmd-1", command: "npm" });
      store.getState().addCommandLog("cmd-1", { stream: "stdout", data: "Installing..." });
      store.getState().addCommandLog("cmd-1", { stream: "stdout", data: "Done!" });

      const commands = store.getState().commands;
      expect(commands[0].logs).toHaveLength(2);
      expect(commands[0].logs[0].data).toBe("Installing...");
      expect(commands[0].logs[0].stream).toBe("stdout");
      expect(commands[0].logs[1].data).toBe("Done!");
    });

    test("addCommandLog ignores unknown command", () => {
      store.getState().addCommandLog("unknown-cmd", { stream: "stdout", data: "test" });

      expect(store.getState().commands).toHaveLength(0);
    });

    test("setCommandExitCode sets exit code", () => {
      store.getState().addCommand({ cmdId: "cmd-1", command: "npm" });
      store.getState().setCommandExitCode("cmd-1", 0);

      expect(store.getState().commands[0].exitCode).toBe(0);
    });
  });

  describe("reset", () => {
    test("reset clears all state", () => {
      store.getState().setSandbox("sbx-123");
      store.getState().addFile("/vercel/sandbox/index.ts");
      store.getState().addCommand({ cmdId: "cmd-1", command: "npm" });
      store.getState().setPreviewUrl("https://preview.vercel.app");

      store.getState().reset();

      const state = store.getState();
      expect(state.sandboxId).toBeNull();
      expect(state.status).toBeNull();
      expect(state.files).toEqual([]);
      expect(state.commands).toEqual([]);
      expect(state.previewUrl).toBeNull();
    });
  });
});

describe("applyStreamData", () => {
  beforeEach(() => {
    store = createSandboxStore();
  });

  test("handles data-sandbox-status with sandboxId", () => {
    store.getState().applyStreamData("data-sandbox-status", {
      sandboxId: "sbx-456",
      status: "ready",
    });

    expect(store.getState().sandboxId).toBe("sbx-456");
    expect(store.getState().status).toBe("ready");
  });

  test("handles data-sandbox-status without sandboxId", () => {
    store.getState().setSandbox("sbx-123");
    store.getState().applyStreamData("data-sandbox-status", { status: "error" });

    expect(store.getState().sandboxId).toBe("sbx-123");
    expect(store.getState().status).toBe("error");
  });

  test("handles data-file-written", () => {
    store.getState().applyStreamData("data-file-written", {
      path: "/vercel/sandbox/app.tsx",
    });

    expect(store.getState().files).toContain(
      "/vercel/sandbox/app.tsx",
    );
  });

  test("handles data-preview-url", () => {
    store.getState().applyStreamData("data-preview-url", {
      url: "https://my-app.vercel.run",
      port: 3000,
    });

    expect(store.getState().previewUrl).toBe(
      "https://my-app.vercel.run",
    );
  });

  test("handles data-command-output", () => {
    store.getState().applyStreamData("data-command-output", {
      command: "npm install",
      output: "added 100 packages",
      stream: "stdout",
    });

    const commands = store.getState().commands;
    expect(commands).toHaveLength(1);
    expect(commands[0].cmdId).toBe("npm install");
    expect(commands[0].logs[0].data).toBe("added 100 packages");
  });

  test("handles data-command-output with exitCode", () => {
    store.getState().applyStreamData("data-command-output", {
      command: "npm test",
      output: "All tests passed",
      stream: "stdout",
      exitCode: 0,
    });

    const commands = store.getState().commands;
    expect(commands[0].exitCode).toBe(0);
  });

  test("ignores unknown data part types", () => {
    store.getState().applyStreamData("data-unknown-type", { foo: "bar" });

    expect(store.getState().sandboxId).toBeNull();
  });

  test("accumulates multiple file writes", () => {
    const s = store.getState();

    s.applyStreamData("data-file-written", {
      path: "/vercel/sandbox/index.ts",
    });
    store.getState().applyStreamData("data-file-written", {
      path: "/vercel/sandbox/app.tsx",
    });
    store.getState().applyStreamData("data-file-written", {
      path: "/vercel/sandbox/styles.css",
    });

    expect(store.getState().files).toHaveLength(3);
  });

  test("accumulates command output over time", () => {
    store.getState().applyStreamData("data-command-output", {
      command: "npm run build",
      output: "Building...",
      stream: "stdout",
    });

    store.getState().applyStreamData("data-command-output", {
      command: "npm run build",
      output: "Compiling TypeScript...",
      stream: "stdout",
    });

    store.getState().applyStreamData("data-command-output", {
      command: "npm run build",
      output: "Done!",
      stream: "stdout",
      exitCode: 0,
    });

    const commands = store.getState().commands;
    expect(commands).toHaveLength(1);
    expect(commands[0].logs).toHaveLength(3);
    expect(commands[0].exitCode).toBe(0);
  });
});

describe("integration: simulated agent stream", () => {
  beforeEach(() => {
    store = createSandboxStore();
  });

  test("processes a typical agent session", () => {
    const s = store.getState();

    s.applyStreamData("data-sandbox-status", {
      sandboxId: "sbx-test-123",
      status: "ready",
    });

    store.getState().applyStreamData("data-file-written", {
      path: "/vercel/sandbox/package.json",
    });
    store.getState().applyStreamData("data-file-written", {
      path: "/vercel/sandbox/src/index.ts",
    });
    store.getState().applyStreamData("data-file-written", {
      path: "/vercel/sandbox/src/App.tsx",
    });

    store.getState().applyStreamData("data-command-output", {
      command: "npm install",
      output: "added 150 packages in 5s",
      stream: "stdout",
      exitCode: 0,
    });

    store.getState().applyStreamData("data-command-output", {
      command: "npm run dev",
      output: "Server running on port 3000",
      stream: "stdout",
    });

    store.getState().applyStreamData("data-preview-url", {
      url: "https://sbx-test-123-3000.vercel.run",
      port: 3000,
    });

    const state = store.getState();
    expect(state.sandboxId).toBe("sbx-test-123");
    expect(state.status).toBe("ready");
    expect(state.files).toHaveLength(3);
    expect(state.files).toContain("/vercel/sandbox/src/App.tsx");
    expect(state.commands).toHaveLength(2);
    expect(state.previewUrl).toBe("https://sbx-test-123-3000.vercel.run");
  });
});
