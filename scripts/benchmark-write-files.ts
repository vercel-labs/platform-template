/**
 * Benchmark writing files directly vs create-next-app
 */

import { Sandbox } from "@vercel/sandbox";

const SANDBOX_BASE_PATH = "/vercel/sandbox";

const PROJECT_FILES = {
  "package.json": JSON.stringify(
    {
      name: "my-app",
      version: "0.1.0",
      private: true,
      scripts: {
        dev: "next dev --turbopack",
        build: "next build",
        start: "next start",
        lint: "next lint",
      },
      dependencies: {
        next: "^15",
        react: "^19",
        "react-dom": "^19",
      },
      devDependencies: {
        "@types/node": "^20",
        "@types/react": "^19",
        "@types/react-dom": "^19",
        typescript: "^5",
        tailwindcss: "^4",
        "@tailwindcss/postcss": "^4",
      },
    },
    null,
    2,
  ),

  "tsconfig.json": JSON.stringify(
    {
      compilerOptions: {
        target: "ES2017",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "preserve",
        incremental: true,
        plugins: [{ name: "next" }],
        paths: { "@/*": ["./src/*"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    },
    null,
    2,
  ),

  "next.config.ts": `import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
`,

  "postcss.config.mjs": `const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
`,

  "src/app/globals.css": `@import "tailwindcss";
`,

  "src/app/layout.tsx": `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "My App",
  description: "Created with Next.js",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,

  "src/app/page.tsx": `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Welcome to your app</h1>
      <p className="mt-4 text-gray-500">Start chatting to build something amazing</p>
    </main>
  );
}
`,
};

async function benchmark() {
  console.log("🚀 Benchmarking file write approach...\n");

  const sandbox = await Sandbox.create({
    ports: [3000],
    timeout: 600_000,
  });
  console.log(`Sandbox: ${sandbox.sandboxId}\n`);

  console.log("Warming up...");
  let t = Date.now();
  await sandbox.runCommand({ cmd: "echo", args: ["warm"], sudo: true });
  console.log(`Warmup: ${Date.now() - t}ms\n`);

  console.log("Writing project files...");
  t = Date.now();

  const files = Object.entries(PROJECT_FILES).map(([path, content]) => ({
    path: `${SANDBOX_BASE_PATH}/${path}`,
    content: Buffer.from(content),
  }));

  await sandbox.writeFiles(files);
  console.log(`Write files: ${Date.now() - t}ms\n`);

  console.log("Running npm install...");
  t = Date.now();
  const install = await sandbox.runCommand({
    cmd: "npm",
    args: ["install"],
    cwd: SANDBOX_BASE_PATH,
    sudo: true,
  });
  console.log(`npm install: ${Date.now() - t}ms`);
  if (install.exitCode !== 0) {
    console.log(`Error: ${await install.stderr()}`);
  }
  console.log();

  console.log("Starting dev server...");
  t = Date.now();
  sandbox
    .runCommand({
      cmd: "npm",
      args: ["run", "dev"],
      cwd: SANDBOX_BASE_PATH,
      sudo: true,
      detached: true,
    })
    .catch(() => {});

  const previewUrl = sandbox.domain(3000);
  let ready = false;
  while (Date.now() - t < 30000) {
    try {
      const res = await fetch(previewUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok || res.status === 404) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(
    `Dev server: ${Date.now() - t}ms (${ready ? "ready" : "timeout"})\n`,
  );

  await sandbox.stop();
  console.log("Done!");
}

benchmark().catch(console.error);
