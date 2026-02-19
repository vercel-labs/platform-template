import type { Sandbox } from "@vercel/sandbox";
import type { Template, SetupProgress } from "../types";
import { run, runOrThrow } from "../utils";
import { SANDBOX_BASE_PATH } from "@/lib/agents/constants";

export const viteTemplate: Template = {
  id: "vite",
  name: "Vite",
  description: "Fast build tool for React SPAs",
  icon: "vite",
  devPort: 5173,

  instructions: `
SANDBOX ENVIRONMENT:
- You are in a Vercel Sandbox at /vercel/sandbox
- Vite with React 18, TypeScript, and Tailwind CSS are pre-installed
 - The setup process starts the dev server on port 5173; the preview updates automatically once ready

PROJECT STRUCTURE:
/vercel/sandbox/
  src/App.tsx           <- EDIT THIS for your app's main content
  src/main.tsx          <- React entry point (renders App)
  src/index.css         <- Global styles, Tailwind imports
  index.html            <- HTML entry point

WORKFLOW:
1. Edit src/App.tsx - changes appear in preview immediately
2. Create new components in src/components/
3. For routing, install react-router-dom if needed

CRITICAL RULES:
- NEVER run npm install, npm run dev, or create-vite
- NEVER create package.json - it exists
 - Do not start a second dev server manually; setup handles it
- Just edit files and the preview updates automatically
`,

  async *setup(sandbox: Sandbox): AsyncGenerator<SetupProgress> {
    yield { stage: "creating-app", message: "Creating Vite app..." };
    await runOrThrow(
      sandbox,
      {
        cmd: "bunx",
        args: [
          "create-vite@latest",
          ".",
          "--template",
          "react-ts",
        ],
        cwd: SANDBOX_BASE_PATH,
        sudo: true,
      },
      "Failed to create Vite app",
    );

    yield { stage: "installing-deps", message: "Installing dependencies..." };
    await run(
      sandbox,
      { cmd: "bun", args: ["install"], cwd: SANDBOX_BASE_PATH, sudo: true },
      "bun install",
    );

    yield { stage: "configuring", message: "Installing Tailwind CSS..." };
    await run(
      sandbox,
      {
        cmd: "bun",
        args: ["add", "-D", "tailwindcss", "@tailwindcss/vite"],
        cwd: SANDBOX_BASE_PATH,
        sudo: true,
      },
      "tailwind install",
    );

    // Update vite.config.ts with tailwind plugin and allowedHosts
    const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: {
    host: true,
    allowedHosts: true,
  },
  plugins: [react(), tailwindcss()],
})
`;

    // Create index.css with Tailwind
    const css = `@import "tailwindcss";
`;

    await Promise.all([
      sandbox.runCommand({
        cmd: "sh",
        args: ["-c", `cat > ${SANDBOX_BASE_PATH}/vite.config.ts << 'VITEEOF'\n${viteConfig}VITEEOF`],
        sudo: true,
      }),
      sandbox.runCommand({
        cmd: "sh",
        args: ["-c", `cat > ${SANDBOX_BASE_PATH}/src/index.css << 'CSSEOF'\n${css}CSSEOF`],
        sudo: true,
      }),
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
        console.error("[vite] Dev server failed:", err);
      });

    yield { stage: "ready", message: "Vite ready" };
  },
};
