import { describe, test, expect, beforeEach } from "vitest";
import { useSandboxStore, handleDataPart } from "../sandbox-store";

describe("SandboxStore", () => {
  beforeEach(() => {
    useSandboxStore.getState().reset();
  });

  describe("sandbox state", () => {
    test("setSandbox initializes sandbox with ID and status", () => {
      useSandboxStore.getState().setSandbox("sbx-123", "ready");

      const state = useSandboxStore.getState();
      expect(state.sandboxId).toBe("sbx-123");
      expect(state.status).toBe("ready");
      expect(state.files).toEqual([]);
      expect(state.commands).toEqual([]);
    });

    test("setPreviewUrl updates preview URL", () => {
      const store = useSandboxStore.getState();
      store.setPreviewUrl("https://preview.vercel.app");

      expect(useSandboxStore.getState().previewUrl).toBe(
        "https://preview.vercel.app",
      );
    });

    test("setStatus updates status", () => {
      const store = useSandboxStore.getState();
      store.setStatus("creating");
      expect(useSandboxStore.getState().status).toBe("creating");

      store.setStatus("ready");
      expect(useSandboxStore.getState().status).toBe("ready");
    });
  });

  describe("file management", () => {
    test("addFile adds a file path", () => {
      const store = useSandboxStore.getState();
      store.addFile("/vercel/sandbox/index.ts");

      expect(useSandboxStore.getState().files).toEqual([
        "/vercel/sandbox/index.ts",
      ]);
    });

    test("addFile deduplicates paths", () => {
      const store = useSandboxStore.getState();
      store.addFile("/vercel/sandbox/index.ts");
      store.addFile("/vercel/sandbox/index.ts");

      expect(useSandboxStore.getState().files).toEqual([
        "/vercel/sandbox/index.ts",
      ]);
    });

    test("addFile sorts paths", () => {
      const store = useSandboxStore.getState();
      store.addFile("/vercel/sandbox/z.ts");
      store.addFile("/vercel/sandbox/a.ts");
      store.addFile("/vercel/sandbox/m.ts");

      expect(useSandboxStore.getState().files).toEqual([
        "/vercel/sandbox/a.ts",
        "/vercel/sandbox/m.ts",
        "/vercel/sandbox/z.ts",
      ]);
    });

    test("addFiles adds multiple files", () => {
      const store = useSandboxStore.getState();
      store.addFiles([
        "/vercel/sandbox/index.ts",
        "/vercel/sandbox/app.tsx",
        "/vercel/sandbox/styles.css",
      ]);

      expect(useSandboxStore.getState().files).toHaveLength(3);
    });

    test("addFiles deduplicates", () => {
      const store = useSandboxStore.getState();
      store.addFile("/vercel/sandbox/index.ts");
      store.addFiles(["/vercel/sandbox/index.ts", "/vercel/sandbox/app.tsx"]);

      expect(useSandboxStore.getState().files).toHaveLength(2);
    });
  });

  describe("command management", () => {
    test("addCommand adds a new command", () => {
      const store = useSandboxStore.getState();
      store.addCommand({
        cmdId: "cmd-1",
        command: "npm",
        args: ["install"],
      });

      const commands = useSandboxStore.getState().commands;
      expect(commands).toHaveLength(1);
      expect(commands[0].cmdId).toBe("cmd-1");
      expect(commands[0].command).toBe("npm");
      expect(commands[0].args).toEqual(["install"]);
      expect(commands[0].logs).toEqual([]);
      expect(commands[0].startedAt).toBeGreaterThan(0);
    });

    test("addCommand does not duplicate", () => {
      const store = useSandboxStore.getState();
      store.addCommand({ cmdId: "cmd-1", command: "npm" });
      store.addCommand({ cmdId: "cmd-1", command: "npm" });

      expect(useSandboxStore.getState().commands).toHaveLength(1);
    });

    test("addCommandLog appends log to command", () => {
      const store = useSandboxStore.getState();
      store.addCommand({ cmdId: "cmd-1", command: "npm" });
      store.addCommandLog("cmd-1", { stream: "stdout", data: "Installing..." });
      store.addCommandLog("cmd-1", { stream: "stdout", data: "Done!" });

      const commands = useSandboxStore.getState().commands;
      expect(commands[0].logs).toHaveLength(2);
      expect(commands[0].logs[0].data).toBe("Installing...");
      expect(commands[0].logs[0].stream).toBe("stdout");
      expect(commands[0].logs[1].data).toBe("Done!");
    });

    test("addCommandLog ignores unknown command", () => {
      const store = useSandboxStore.getState();
      store.addCommandLog("unknown-cmd", { stream: "stdout", data: "test" });

      expect(useSandboxStore.getState().commands).toHaveLength(0);
    });

    test("setCommandExitCode sets exit code", () => {
      const store = useSandboxStore.getState();
      store.addCommand({ cmdId: "cmd-1", command: "npm" });
      store.setCommandExitCode("cmd-1", 0);

      expect(useSandboxStore.getState().commands[0].exitCode).toBe(0);
    });
  });

  describe("reset", () => {
    test("reset clears all state", () => {
      const store = useSandboxStore.getState();
      store.setSandbox("sbx-123");
      store.addFile("/vercel/sandbox/index.ts");
      store.addCommand({ cmdId: "cmd-1", command: "npm" });
      store.setPreviewUrl("https://preview.vercel.app");

      store.reset();

      const state = useSandboxStore.getState();
      expect(state.sandboxId).toBeNull();
      expect(state.status).toBeNull();
      expect(state.files).toEqual([]);
      expect(state.commands).toEqual([]);
      expect(state.previewUrl).toBeNull();
    });
  });
});

describe("handleDataPart", () => {
  beforeEach(() => {
    useSandboxStore.getState().reset();
  });

  test("handles data-sandbox-status with sandboxId", () => {
    const store = useSandboxStore.getState();
    handleDataPart(store, "data-sandbox-status", {
      sandboxId: "sbx-456",
      status: "ready",
    });

    expect(useSandboxStore.getState().sandboxId).toBe("sbx-456");
    expect(useSandboxStore.getState().status).toBe("ready");
  });

  test("handles data-sandbox-status without sandboxId", () => {
    const store = useSandboxStore.getState();
    store.setSandbox("sbx-123");
    handleDataPart(store, "data-sandbox-status", { status: "error" });

    expect(useSandboxStore.getState().sandboxId).toBe("sbx-123");
    expect(useSandboxStore.getState().status).toBe("error");
  });

  test("handles data-file-written", () => {
    const store = useSandboxStore.getState();
    handleDataPart(store, "data-file-written", {
      path: "/vercel/sandbox/app.tsx",
    });

    expect(useSandboxStore.getState().files).toContain(
      "/vercel/sandbox/app.tsx",
    );
  });

  test("handles data-preview-url", () => {
    const store = useSandboxStore.getState();
    handleDataPart(store, "data-preview-url", {
      url: "https://my-app.vercel.run",
      port: 3000,
    });

    expect(useSandboxStore.getState().previewUrl).toBe(
      "https://my-app.vercel.run",
    );
  });

  test("handles data-command-output", () => {
    const store = useSandboxStore.getState();
    handleDataPart(store, "data-command-output", {
      command: "npm install",
      output: "added 100 packages",
      stream: "stdout",
    });

    const commands = useSandboxStore.getState().commands;
    expect(commands).toHaveLength(1);
    expect(commands[0].cmdId).toBe("npm install");
    expect(commands[0].logs[0].data).toBe("added 100 packages");
  });

  test("handles data-command-output with exitCode", () => {
    const store = useSandboxStore.getState();
    handleDataPart(store, "data-command-output", {
      command: "npm test",
      output: "All tests passed",
      stream: "stdout",
      exitCode: 0,
    });

    const commands = useSandboxStore.getState().commands;
    expect(commands[0].exitCode).toBe(0);
  });

  test("ignores unknown data part types", () => {
    const store = useSandboxStore.getState();
    handleDataPart(store, "data-unknown-type", { foo: "bar" });

    expect(useSandboxStore.getState().sandboxId).toBeNull();
  });

  test("accumulates multiple file writes", () => {
    const store = useSandboxStore.getState();

    handleDataPart(store, "data-file-written", {
      path: "/vercel/sandbox/index.ts",
    });
    handleDataPart(store, "data-file-written", {
      path: "/vercel/sandbox/app.tsx",
    });
    handleDataPart(store, "data-file-written", {
      path: "/vercel/sandbox/styles.css",
    });

    expect(useSandboxStore.getState().files).toHaveLength(3);
  });

  test("accumulates command output over time", () => {
    const store = useSandboxStore.getState();

    handleDataPart(store, "data-command-output", {
      command: "npm run build",
      output: "Building...",
      stream: "stdout",
    });

    handleDataPart(store, "data-command-output", {
      command: "npm run build",
      output: "Compiling TypeScript...",
      stream: "stdout",
    });

    handleDataPart(store, "data-command-output", {
      command: "npm run build",
      output: "Done!",
      stream: "stdout",
      exitCode: 0,
    });

    const commands = useSandboxStore.getState().commands;
    expect(commands).toHaveLength(1);
    expect(commands[0].logs).toHaveLength(3);
    expect(commands[0].exitCode).toBe(0);
  });
});

describe("integration: simulated agent stream", () => {
  beforeEach(() => {
    useSandboxStore.getState().reset();
  });

  test("processes a typical agent session", () => {
    const store = useSandboxStore.getState();

    handleDataPart(store, "data-sandbox-status", {
      sandboxId: "sbx-test-123",
      status: "ready",
    });

    handleDataPart(store, "data-file-written", {
      path: "/vercel/sandbox/package.json",
    });
    handleDataPart(store, "data-file-written", {
      path: "/vercel/sandbox/src/index.ts",
    });
    handleDataPart(store, "data-file-written", {
      path: "/vercel/sandbox/src/App.tsx",
    });

    handleDataPart(store, "data-command-output", {
      command: "npm install",
      output: "added 150 packages in 5s",
      stream: "stdout",
      exitCode: 0,
    });

    handleDataPart(store, "data-command-output", {
      command: "npm run dev",
      output: "Server running on port 3000",
      stream: "stdout",
    });

    handleDataPart(store, "data-preview-url", {
      url: "https://sbx-test-123-3000.vercel.run",
      port: 3000,
    });

    const state = useSandboxStore.getState();
    expect(state.sandboxId).toBe("sbx-test-123");
    expect(state.status).toBe("ready");
    expect(state.files).toHaveLength(3);
    expect(state.files).toContain("/vercel/sandbox/src/App.tsx");
    expect(state.commands).toHaveLength(2);
    expect(state.previewUrl).toBe("https://sbx-test-123-3000.vercel.run");
  });
});
