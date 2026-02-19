import type { Sandbox } from "@vercel/sandbox";
import type { Template, SetupProgress } from "../types";
import { run, runOrThrow } from "../utils";
import { SANDBOX_BASE_PATH } from "@/lib/agents/constants";

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
 - The setup process starts the dev server on port 3000; the preview updates automatically once ready

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
 - Do not start a second dev server manually; setup handles it
- Just edit files and the preview updates automatically
`,

  async *setup(sandbox: Sandbox): AsyncGenerator<SetupProgress> {
    yield { stage: "creating-app", message: "Creating TanStack Start app..." };
    
    // Download tarball from GitHub and extract the start-basic example,
    // then fix ownership so writeFiles (runs as vercel-sandbox) can modify them
    await runOrThrow(
      sandbox,
      {
        cmd: "sh",
        args: [
          "-c",
          `mkdir -p ${SANDBOX_BASE_PATH} && curl -sL https://codeload.github.com/tanstack/router/tar.gz/main | tar -xz --strip-components=4 -C ${SANDBOX_BASE_PATH} router-main/examples/react/start-basic && chown -R vercel-sandbox:vercel-sandbox ${SANDBOX_BASE_PATH}`,
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

    // Remove demo routes, components, and utils from the start-basic template
    await run(
      sandbox,
      {
        cmd: "sh",
        args: [
          "-c",
          [
            `rm -rf ${SANDBOX_BASE_PATH}/src/routes/posts.tsx`,
            `rm -rf ${SANDBOX_BASE_PATH}/src/routes/posts.index.tsx`,
            `rm -rf "${SANDBOX_BASE_PATH}/src/routes/posts.\\$postId.tsx"`,
            `rm -rf "${SANDBOX_BASE_PATH}/src/routes/posts_.\\$postId.deep.tsx"`,
            `rm -rf ${SANDBOX_BASE_PATH}/src/routes/users.tsx`,
            `rm -rf ${SANDBOX_BASE_PATH}/src/routes/users.index.tsx`,
            `rm -rf "${SANDBOX_BASE_PATH}/src/routes/users.\\$userId.tsx"`,
            `rm -rf ${SANDBOX_BASE_PATH}/src/routes/deferred.tsx`,
            `rm -rf ${SANDBOX_BASE_PATH}/src/routes/redirect.tsx`,
            `rm -rf "${SANDBOX_BASE_PATH}/src/routes/customScript[.]js.ts"`,
            `rm -rf ${SANDBOX_BASE_PATH}/src/routes/_pathlessLayout.tsx`,
            `rm -rf ${SANDBOX_BASE_PATH}/src/routes/_pathlessLayout`,
            `rm -rf ${SANDBOX_BASE_PATH}/src/routes/api`,
            `rm -rf ${SANDBOX_BASE_PATH}/src/utils/posts.tsx`,
            `rm -rf ${SANDBOX_BASE_PATH}/src/utils/users.tsx`,
            `rm -rf ${SANDBOX_BASE_PATH}/src/utils/loggingMiddleware.tsx`,
            `rm -rf ${SANDBOX_BASE_PATH}/src/components/PostError.tsx`,
            `rm -rf ${SANDBOX_BASE_PATH}/src/components/UserError.tsx`,
          ].join(" && "),
        ],
        sudo: true,
      },
      "cleanup demo files",
    );

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

    // Minimal root layout (no devtools, no demo nav)
    const rootRoute = `/// <reference types="vite/client" />
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import * as React from 'react'
import appCss from '~/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
`;

    // Minimal index route
    const indexRoute = `import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">Hello World</h1>
    </div>
  )
}
`;

    await sandbox.writeFiles([
      { path: `${SANDBOX_BASE_PATH}/vite.config.ts`, content: Buffer.from(viteConfig) },
      { path: `${SANDBOX_BASE_PATH}/src/routes/__root.tsx`, content: Buffer.from(rootRoute) },
      { path: `${SANDBOX_BASE_PATH}/src/routes/index.tsx`, content: Buffer.from(indexRoute) },
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
