import type { Sandbox } from "@vercel/sandbox";

export type TemplateId = "nextjs" | "vite" | "tanstack-start";

export type SetupStage =
  | "creating-app"
  | "installing-deps"
  | "configuring"
  | "ready";

export interface SetupProgress {
  stage: SetupStage;
  message: string;
}

export interface Template {
  id: TemplateId;
  name: string;
  description: string;
  icon: string;
  devPort: number;
  instructions: string;
  setup(sandbox: Sandbox): AsyncGenerator<SetupProgress>;
}
