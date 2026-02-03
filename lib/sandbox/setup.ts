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
export async function* setupSandbox(
  sandbox: Sandbox,
  options: SetupOptions,
): AsyncGenerator<SetupProgress> {
  const { agentId } = options;

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

  yield { stage: "installing-deps", message: "Installing dependencies..." };
  await run(
    sandbox,
    { cmd: "bun", args: ["install"], cwd: SANDBOX_BASE_PATH, sudo: true },
    "bun install",
  );

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

  await Promise.all([
    sandbox.runCommand({
      cmd: "rm",
      args: ["-f", `${SANDBOX_BASE_PATH}/src/app/favicon.ico`],
      sudo: true,
    }),
    sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `for f in ${SANDBOX_BASE_PATH}/src/components/ui/*.tsx; do grep -q "@ts-nocheck" "$f" || sed -i '1s/^/\\/\\/ @ts-nocheck\\n/' "$f"; done`,
      ],
      sudo: true,
    }),
    sandbox.runCommand({
      cmd: "chmod",
      args: ["-R", "777", SANDBOX_BASE_PATH],
      sudo: true,
    }),
  ]);

  yield {
    stage: "installing-agent",
    message: "Installing agent & starting dev server...",
  };

  const agent = AGENTS[agentId];

  sandbox
    .runCommand({
      cmd: "bun",
      args: ["run", "dev"],
      cwd: SANDBOX_BASE_PATH,
      sudo: true,
      detached: true,
    })
    .catch((err) => {
      console.error("[setup] Dev server command failed:", err);
    });

  const agentInstallPromise = agent
    ? run(
        sandbox,
        { cmd: "sh", args: ["-c", agent.install], sudo: agent.sudo },
        `${agentId} install`,
      )
    : Promise.resolve(null);

  const devServerPromise = waitForDevServer(sandbox.domain(SANDBOX_DEV_PORT));

  await Promise.all([agentInstallPromise, devServerPromise]);

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
