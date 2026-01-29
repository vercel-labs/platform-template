export const SANDBOX_INSTRUCTIONS = `
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
`;

export const SANDBOX_DEV_PORT = 3000;

export const SANDBOX_BASE_PATH = "/vercel/sandbox";
