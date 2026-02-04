import type { Sandbox, CommandFinished } from "@vercel/sandbox";

export async function run(
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

export async function runOrThrow(
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
