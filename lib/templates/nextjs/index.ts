import type { Sandbox } from "@vercel/sandbox";
import type { Template, SetupProgress } from "../types";
import { run, runOrThrow } from "../utils";

const SANDBOX_BASE_PATH = "/vercel/sandbox";

export const nextjsTemplate: Template = {
  id: "nextjs",
  name: "Next.js",
  description: "React framework with server components",
  icon: "nextjs",
  devPort: 3000,

  instructions: `
SANDBOX ENVIRONMENT:
- You are in a Vercel Sandbox at /vercel/sandbox
- Next.js (latest), React 19, Tailwind CSS, TypeScript are pre-installed
- The dev server is ALREADY RUNNING on port 3000 - the preview updates automatically
- ALL shadcn/ui components are pre-installed in src/components/ui/

PROJECT STRUCTURE:
/vercel/sandbox/
  src/app/page.tsx      <- EDIT THIS for your app's main content
  src/app/layout.tsx    <- Root layout (html, body, providers)
  src/app/globals.css   <- Global styles, Tailwind imports
  src/lib/utils.ts      <- cn() utility for className merging
  src/components/ui/    <- ALL shadcn components are here (button, card, input, slider, etc.)

WORKFLOW:
1. Edit src/app/page.tsx - changes appear in preview immediately
2. Import shadcn components: import { Button } from "@/components/ui/button"
3. New routes: create src/app/about/page.tsx for /about

CRITICAL RULES:
- NEVER run npm install, npm run dev, or create-next-app
- NEVER run npx shadcn add - all components are already installed
- NEVER create package.json - it exists
- NEVER start the dev server - it's already running
- Just edit files and the preview updates automatically
`,

  async *setup(sandbox: Sandbox): AsyncGenerator<SetupProgress> {
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

    yield { stage: "configuring", message: "Adding shadcn/ui components..." };
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

    // Clean up and fix shadcn components
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
    ]);

    // Start dev server
    sandbox
      .runCommand({
        cmd: "bun",
        args: ["run", "dev"],
        cwd: SANDBOX_BASE_PATH,
        sudo: true,
        detached: true,
      })
      .catch((err) => {
        console.error("[nextjs] Dev server failed:", err);
      });

    yield { stage: "ready", message: "Next.js ready" };
  },
};
