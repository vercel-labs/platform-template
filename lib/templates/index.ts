import { nextjsTemplate } from "./nextjs";
import { viteTemplate } from "./vite";
import { tanstackStartTemplate } from "./tanstack-start";
import type { Template, TemplateId } from "./types";

export type { Template, TemplateId, SetupProgress, SetupStage } from "./types";

export const templates: Record<TemplateId, Template> = {
  nextjs: nextjsTemplate,
  vite: viteTemplate,
  "tanstack-start": tanstackStartTemplate,
};

export const DEFAULT_TEMPLATE_ID: TemplateId = "nextjs";

export function getTemplate(id: TemplateId): Template {
  const template = templates[id];
  if (!template) {
    throw new Error(`Unknown template: ${id}`);
  }
  return template;
}

export function listTemplates(): Template[] {
  return Object.values(templates);
}

export function isValidTemplate(id: string): id is TemplateId {
  return id in templates;
}
