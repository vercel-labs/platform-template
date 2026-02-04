import type { Sandbox } from "@vercel/sandbox";
import type { Template, SetupProgress } from "../types";
import { run, runOrThrow } from "../utils";

const SANDBOX_BASE_PATH = "/vercel/sandbox";

export const tanstackStartTemplate: Template = {
  id: "tanstack-start",
  name: "TanStack Start",
  description: "Full-stack React framework",
  icon: "tanstack",
  devPort: 3000,

  instructions: `
SANDBOX ENVIRONMENT:
- You are in a Vercel Sandbox at /vercel/sandbox
- TanStack Start with React 19, TypeScript, Vite, and Tailwind CSS are pre-installed
- The dev server is ALREADY RUNNING on port 3000 - the preview updates automatically

PROJECT STRUCTURE:
/vercel/sandbox/
  src/routes/index.tsx      <- EDIT THIS for your app's home page
  src/routes/__root.tsx     <- Root layout component
  src/router.tsx            <- Router configuration
  src/styles/app.css        <- Global styles with Tailwind
  src/components/           <- Reusable components
  src/routeTree.gen.ts      <- Auto-generated (do not edit)
  vite.config.ts            <- Vite configuration

WORKFLOW:
1. Edit src/routes/index.tsx - changes appear in preview immediately
2. Create new routes: src/routes/about.tsx for /about
3. Use file-based routing with TanStack Router conventions
4. Use Tailwind CSS classes for styling

CRITICAL RULES:
- NEVER run npm install, npm run dev, or create new projects
- NEVER create package.json - it exists
- NEVER start the dev server - it's already running
- Just edit files and the preview updates automatically
`,

  async *setup(sandbox: Sandbox): AsyncGenerator<SetupProgress> {
    yield { stage: "creating-app", message: "Creating TanStack Start app..." };
    
    // Download tarball from GitHub and extract the start-basic example
    await runOrThrow(
      sandbox,
      {
        cmd: "sh",
        args: [
          "-c",
          `mkdir -p ${SANDBOX_BASE_PATH} && curl -sL https://codeload.github.com/tanstack/router/tar.gz/main | tar -xz --strip-components=4 -C ${SANDBOX_BASE_PATH} router-main/examples/react/start-basic`,
        ],
        sudo: true,
      },
      "Failed to create TanStack Start app",
    );

    yield { stage: "installing-deps", message: "Installing dependencies..." };
    await run(
      sandbox,
      { cmd: "bun", args: ["install"], cwd: SANDBOX_BASE_PATH, sudo: true },
      "bun install",
    );

    yield { stage: "configuring", message: "Configuring Vite..." };

    // Update vite.config.ts to allow all hosts for sandbox access
    const viteConfig = `import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

export default defineConfig({
  server: {
    port: 3000,
    host: true,
    allowedHosts: true,
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart({
      srcDirectory: 'src',
    }),
    viteReact(),
    nitro(),
  ],
})
`;

    await sandbox.writeFiles([
      { path: `${SANDBOX_BASE_PATH}/vite.config.ts`, content: Buffer.from(viteConfig) },
    ]);

    // Start dev server
    sandbox
      .runCommand({
        cmd: "bun",
        args: ["run", "dev", "--host"],
        cwd: SANDBOX_BASE_PATH,
        sudo: true,
        detached: true,
      })
      .catch((err) => {
        console.error("[tanstack-start] Dev server failed:", err);
      });

    yield { stage: "ready", message: "TanStack Start ready" };
  },
};
