import type { Sandbox, CommandFinished } from "@vercel/sandbox";
import {
  SANDBOX_BASE_PATH,
  SANDBOX_DEV_PORT,
  DEV_SERVER_READY_TIMEOUT_MS,
} from "@/lib/agents/constants";
import { Result } from "better-result";

export type SetupStage =
  | "installing-bun"
  | "creating-app"
  | "installing-deps"
  | "installing-shadcn"
  | "installing-agent"
  | "ready";

export interface SetupProgress {
  stage: SetupStage;
  message: string;
}

export interface SetupOptions {
  agentId: string;
}

// Agent CLI install commands and sudo requirements
const AGENTS: Record<string, { install: string; sudo: boolean }> = {
  claude: {
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    sudo: false,
  },
  codex: { install: "bun i -g @openai/codex", sudo: true },
  opencode: {
    install: "curl -fsSL https://opencode.ai/install | bash",
    sudo: false,
  },
};

// Helper to run command and log failures (non-fatal)
async function run(
  sandbox: Sandbox,
  opts: Parameters<Sandbox["runCommand"]>[0],
  label?: string,
): Promise<CommandFinished> {
  const result = await sandbox.runCommand(opts);
  if (result.exitCode !== 0 && label) {
    console.error(
      `[setup] ${label} failed (exit ${result.exitCode}):`,
      await result.stderr(),
    );
  }
  return result;
}

// Helper to run command and throw on failure (fatal)
async function runOrThrow(
  sandbox: Sandbox,
  opts: Parameters<Sandbox["runCommand"]>[0],
  errorMessage: string,
): Promise<CommandFinished> {
  const result = await sandbox.runCommand(opts);
  if (!result || result.exitCode !== 0) {
    const stderr = result
      ? await result.stderr()
      : "runCommand returned undefined";
    throw new Error(`${errorMessage}: ${stderr}`);
  }
  return result;
}

/**
 * Sets up a blank sandbox with Next.js, Tailwind, and shadcn/ui.
 * Uses bun for speed (~15s total vs ~77s with npm).
 */
export async function* setupSandbox(
  sandbox: Sandbox,
  options: SetupOptions,
): AsyncGenerator<SetupProgress> {
  const { agentId } = options;

  // Step 1: Install bun and symlink to system PATH
  yield { stage: "installing-bun", message: "Installing bun..." };
  await run(
    sandbox,
    {
      cmd: "sh",
      args: [
        "-c",
        "curl -fsSL https://bun.sh/install | bash && ln -sf /root/.bun/bin/bun /usr/local/bin/bun && ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx",
      ],
      sudo: true,
    },
    "bun install",
  );

  // Step 2: Create Next.js app (skip install - we'll do one combined install later)
  yield { stage: "creating-app", message: "Creating Next.js app..." };
  await runOrThrow(
    sandbox,
    {
      cmd: "bunx",
      args: [
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
        "--skip-install",
      ],
      env: { CI: "true" },
      sudo: true,
    },
    "Failed to create Next.js app",
  );

  // Step 3: Install dependencies (shadcn needs these to run)
  yield { stage: "installing-deps", message: "Installing dependencies..." };
  await run(
    sandbox,
    { cmd: "bun", args: ["install"], cwd: SANDBOX_BASE_PATH, sudo: true },
    "bun install",
  );

  // Step 4: Setup shadcn and add all components
  yield {
    stage: "installing-shadcn",
    message: "Adding shadcn/ui components...",
  };
  await run(
    sandbox,
    {
      cmd: "bunx",
      args: ["shadcn@latest", "init", "-y", "-d"],
      cwd: SANDBOX_BASE_PATH,
      sudo: true,
    },
    "shadcn init",
  );
  await run(
    sandbox,
    {
      cmd: "bunx",
      args: ["shadcn@latest", "add", "--all", "-y", "-o"],
      cwd: SANDBOX_BASE_PATH,
      sudo: true,
    },
    "shadcn add --all",
  );

  // Step 5: Cleanup and fix permissions
  await Promise.all([
    // Remove corrupted favicon that breaks Turbopack builds
    sandbox.runCommand({
      cmd: "rm",
      args: ["-f", `${SANDBOX_BASE_PATH}/src/app/favicon.ico`],
      sudo: true,
    }),
    // Add @ts-nocheck to shadcn components (some have type errors with latest deps)
    sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `for f in ${SANDBOX_BASE_PATH}/src/components/ui/*.tsx; do grep -q "@ts-nocheck" "$f" || sed -i '1s/^/\\/\\/ @ts-nocheck\\n/' "$f"; done`,
      ],
      sudo: true,
    }),
    // Make project writable by non-root users (Claude runs without sudo)
    sandbox.runCommand({
      cmd: "chmod",
      args: ["-R", "777", SANDBOX_BASE_PATH],
      sudo: true,
    }),
  ]);

  // Step 6: Start dev server and install agent CLI in parallel
  yield {
    stage: "installing-agent",
    message: "Installing agent & starting dev server...",
  };

  const agent = AGENTS[agentId];

  // Start dev server (detached - fire and forget)
  sandbox
    .runCommand({
      cmd: "bun",
      args: ["run", "dev"],
      cwd: SANDBOX_BASE_PATH,
      sudo: true,
      detached: true,
    })
    .catch((err) => {
      // Log but don't fail - the dev server runs detached
      console.error("[setup] Dev server command failed:", err);
    });

  // Install agent CLI
  const agentInstallPromise = agent
    ? run(
        sandbox,
        { cmd: "sh", args: ["-c", agent.install], sudo: agent.sudo },
        `${agentId} install`,
      )
    : Promise.resolve(null);

  // Wait for dev server to be ready
  const devServerPromise = waitForDevServer(sandbox.domain(SANDBOX_DEV_PORT));

  await Promise.all([agentInstallPromise, devServerPromise]);

  // Verify agent binary exists
  if (agent) {
    const pathPrefix = agent.sudo
      ? ""
      : 'export PATH="$HOME/.local/bin:$PATH" && ';
    const result = await Result.tryPromise(() =>
      sandbox
        .runCommand({
          cmd: "sh",
          args: ["-c", `${pathPrefix}which ${agentId}`],
          sudo: agent.sudo,
        })
        .then((r) => r.stdout())
        .then((s) => s.trim()),
    );
    if (result.isOk() && result.value) {
      console.log(`[setup] ${agentId} binary at: ${result.value}`);
    } else {
      console.error(`[setup] ${agentId} binary not found after install`);
    }
  }

  yield { stage: "ready", message: "Sandbox ready" };
}

async function waitForDevServer(
  url: string,
  timeoutMs = DEV_SERVER_READY_TIMEOUT_MS,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await Result.tryPromise(() =>
      fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) }),
    );
    if (result.isOk() && (result.value.ok || result.value.status === 404)) {
      console.log("[setup] Dev server ready");
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.warn("[setup] Dev server timeout");
  return false;
}
