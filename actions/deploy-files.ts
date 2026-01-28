"use server";

import { cookies } from "next/headers";
import { Sandbox } from "@vercel/sandbox";
import { Vercel } from "@vercel/sdk";
import { SkipAutoDetectionConfirmation } from "@vercel/sdk/models/createdeploymentop.js";
import { getSessionFromCookie, SESSION_COOKIE_NAME } from "@/lib/auth";

const SANDBOX_BASE_PATH = "/vercel/sandbox";

interface DeployFilesParams {
  sandboxId: string;
  deploymentName?: string;
  projectId?: string | null;
}

interface DeploymentResult {
  url: string;
  id: string;
  projectId: string;
}

function toRelativePath(absolutePath: string): string {
  let path = absolutePath;

  if (path.startsWith(SANDBOX_BASE_PATH + "/")) {
    path = path.slice(SANDBOX_BASE_PATH.length + 1);
  } else if (path.startsWith(SANDBOX_BASE_PATH)) {
    path = path.slice(SANDBOX_BASE_PATH.length);
  }

  if (path.startsWith("/")) {
    path = path.slice(1);
  }

  return path;
}

async function listFilesInSandbox(sandbox: Sandbox): Promise<string[]> {
  const result = await sandbox.runCommand("find", [
    SANDBOX_BASE_PATH,
    "-type",
    "f",
    "-not",
    "-path",
    "*/node_modules/*",
    "-not",
    "-path",
    "*/.git/*",
    "-not",
    "-path",
    "*/.next/*",
    "-not",
    "-name",
    "*.log",
  ]);

  if (result.exitCode !== 0) {
    const stderr = await result.stderr();
    console.error("[deploy] Failed to list files:", stderr);
    throw new Error("Failed to list files in sandbox");
  }

  const stdout = await result.stdout();
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function deployFiles(
  params: DeployFilesParams
): Promise<DeploymentResult> {
  const { sandboxId, deploymentName, projectId } = params;

  console.log("[deploy] Starting deployment", { sandboxId });

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSessionFromCookie(sessionCookie);

  if (!session?.tokens?.accessToken) {
    throw new Error("Unauthorized - please sign in to deploy");
  }

  const sandbox = await Sandbox.get({ sandboxId });

  const absolutePaths = await listFilesInSandbox(sandbox);
  console.log("[deploy] Found files in sandbox:", absolutePaths.length);

  const readFile = async (absolutePath: string) => {
    const relativePath = toRelativePath(absolutePath);
    const stream = await sandbox.readFile({ path: absolutePath });
    if (!stream) {
      throw new Error(`File not found: ${absolutePath}`);
    }
    const response = new Response(stream as unknown as ReadableStream);
    const text = await response.text();
    return { file: relativePath, data: text };
  };

  const files = await Promise.all(absolutePaths.map(readFile));

  console.log("[deploy] Read files:", files.map((f) => f.file));

  const hasPackageJson = files.some(
    (f) => f.file === "package.json" || f.file.endsWith("/package.json")
  );
  if (!hasPackageJson) {
    console.error(
      "[deploy] No package.json found in:",
      files.map((f) => f.file)
    );
    throw new Error("No package.json found in files");
  }

  const vercel = new Vercel({
    bearerToken: session.tokens.accessToken,
  });

  const random4Chars = Math.random().toString(36).substring(2, 6);
  const name = deploymentName || `platform-deploy-${random4Chars}`;

  const deployment = await vercel.deployments.createDeployment({
    requestBody: {
      name,
      files,
      target: "production",
      project: projectId ?? undefined,
    },
    skipAutoDetectionConfirmation: SkipAutoDetectionConfirmation.One,
  });

  if (!projectId) {
    await vercel.projects.updateProject({
      requestBody: { ssoProtection: null },
      idOrName: deployment.projectId,
    });
  }

  return {
    url: deployment.url,
    id: deployment.id,
    projectId: deployment.projectId,
  };
}

export async function getDeploymentStatus(deploymentId: string) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSessionFromCookie(sessionCookie);

  if (!session?.tokens?.accessToken) {
    throw new Error("Unauthorized");
  }

  const vercel = new Vercel({
    bearerToken: session.tokens.accessToken,
  });

  const deployment = await vercel.deployments.getDeployment({
    idOrUrl: deploymentId,
  });

  return {
    readyState: deployment.readyState,
    url: deployment.url,
    id: deployment.id,
  };
}
