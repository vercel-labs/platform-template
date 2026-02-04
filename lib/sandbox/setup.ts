import type { Sandbox, CommandFinished } from "@vercel/sandbox";
import {
  SANDBOX_BASE_PATH,
  DEV_SERVER_READY_TIMEOUT_MS,
} from "@/lib/agents/constants";
import {
  getTemplate,
  type TemplateId,
  DEFAULT_TEMPLATE_ID,
} from "@/lib/templates";
import { Result } from "better-result";

export type SetupStage =
  | "installing-bun"
  | "creating-app"
  | "installing-deps"
  | "configuring"
  | "installing-agent"
  | "ready";

export interface SetupProgress {
  stage: SetupStage;
  message: string;
}

export interface SetupOptions {
  agentId: string;
  templateId?: TemplateId;
}

const AGENTS: Record<string, { install: string; sudo: boolean }> = {
  claude: {
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    sudo: false,
  },
  codex: { install: "bun i -g @openai/codex@0.94.0", sudo: true },
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

export async function* setupSandbox(
  sandbox: Sandbox,
  options: SetupOptions,
): AsyncGenerator<SetupProgress> {
  const { agentId, templateId = DEFAULT_TEMPLATE_ID } = options;
  const template = getTemplate(templateId);

  // Install bun
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

  // Run template-specific setup
  for await (const progress of template.setup(sandbox)) {
    yield {
      stage: progress.stage,
      message: progress.message,
    };
  }

  // Make sure permissions are set
  await sandbox.runCommand({
    cmd: "chmod",
    args: ["-R", "777", SANDBOX_BASE_PATH],
    sudo: true,
  });

  // Install agent and wait for dev server (already started by template)
  yield {
    stage: "installing-agent",
    message: "Installing agent...",
  };

  const agent = AGENTS[agentId];

  const agentInstallPromise = agent
    ? run(
        sandbox,
        { cmd: "sh", args: ["-c", agent.install], sudo: agent.sudo },
        `${agentId} install`,
      )
    : Promise.resolve(null);

  const devServerPromise = waitForDevServer(sandbox.domain(template.devPort));

  await Promise.all([agentInstallPromise, devServerPromise]);

  if (agent) {
    // Always include common binary paths when checking for the installed agent
    const pathExport = 'export PATH="$PATH:/root/.local/bin:/root/.bun/bin:$HOME/.local/bin" && ';
    const result = await Result.tryPromise(() =>
      sandbox
        .runCommand({
          cmd: "sh",
          args: ["-c", `${pathExport}which ${agentId}`],
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
