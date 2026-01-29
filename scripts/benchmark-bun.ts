/**
 * Benchmark using bun instead of npm
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
  plugins: { "@tailwindcss/postcss": {} },
};
export default config;
`,

  "src/app/globals.css": `@import "tailwindcss";`,

  "src/app/layout.tsx": `import "./globals.css";
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
`,

  "src/app/page.tsx": `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Welcome</h1>
    </main>
  );
}
`,
};

async function benchmark() {
  console.log("🚀 Benchmarking with bun...\n");

  const sandbox = await Sandbox.create({
    ports: [3000],
    timeout: 600_000,
  });
  console.log(`Sandbox: ${sandbox.sandboxId}\n`);

  // Warm up
  console.log("Warming up...");
  let t = Date.now();
  await sandbox.runCommand({ cmd: "echo", args: ["warm"], sudo: true });
  console.log(`Warmup: ${Date.now() - t}ms\n`);

  // Check if bun exists
  const bunCheck = await sandbox.runCommand({
    cmd: "which",
    args: ["bun"],
    sudo: true,
  });
  const hasBun = bunCheck.exitCode === 0;
  console.log(`Bun available: ${hasBun}`);

  if (!hasBun) {
    console.log("Installing bun...");
    t = Date.now();
    await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "curl -fsSL https://bun.sh/install | bash"],
      sudo: true,
    });
    console.log(`Bun install: ${Date.now() - t}ms\n`);
  }

  // Write files
  console.log("Writing project files...");
  t = Date.now();
  const files = Object.entries(PROJECT_FILES).map(([path, content]) => ({
    path: `${SANDBOX_BASE_PATH}/${path}`,
    content: Buffer.from(content),
  }));
  await sandbox.writeFiles(files);
  console.log(`Write files: ${Date.now() - t}ms\n`);

  // bun install
  console.log("Running bun install...");
  t = Date.now();
  const install = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      "export BUN_INSTALL=/root/.bun && export PATH=$BUN_INSTALL/bin:$PATH && bun install",
    ],
    cwd: SANDBOX_BASE_PATH,
    sudo: true,
  });
  console.log(`bun install: ${Date.now() - t}ms`);
  console.log(`exit code: ${install.exitCode}`);
  console.log(`stdout: ${await install.stdout()}`);
  if (install.exitCode !== 0) {
    console.log(`stderr: ${await install.stderr()}`);
  }
  console.log();

  await sandbox.stop();
  console.log("Done!");
}

benchmark().catch(console.error);
