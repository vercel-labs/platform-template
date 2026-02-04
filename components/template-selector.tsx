"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSandboxStore } from "@/lib/store/sandbox-store";
import { listTemplates, type TemplateId } from "@/lib/templates";
import { cn } from "@/lib/utils";

const TEMPLATES = listTemplates();

interface TemplateSelectorProps {
  className?: string;
  disabled?: boolean;
}

export function TemplateSelector({ className, disabled }: TemplateSelectorProps) {
  const { templateId, setTemplateId } = useSandboxStore();

  const selectedTemplate = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800",
          className,
        )}
      >
        <TemplateIcon templateId={selectedTemplate.id} />
        <span>{selectedTemplate.name}</span>
        <ChevronDown className="h-4 w-4 text-zinc-500" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {TEMPLATES.map((template) => (
          <DropdownMenuItem
            key={template.id}
            onClick={() => setTemplateId(template.id)}
            className={cn(
              "flex items-center gap-3 cursor-pointer",
              template.id === templateId && "bg-zinc-100 dark:bg-zinc-800",
            )}
          >
            <TemplateIcon templateId={template.id} className="h-5 w-5" />
            <div className="flex flex-col">
              <span className="font-medium">{template.name}</span>
              <span className="text-xs text-zinc-500">{template.description}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TemplateIcon({
  templateId,
  className,
}: {
  templateId: TemplateId;
  className?: string;
}) {
  const iconUrls: Record<TemplateId, string> = {
    nextjs: "https://models.dev/logos/nextjs.svg",
    vite: "https://vitejs.dev/logo.svg",
    "tanstack-start": "https://tanstack.com/favicon.png",
  };

  return (
    <img
      src={iconUrls[templateId]}
      alt={`${templateId} logo`}
      className={cn("h-4 w-4", templateId === "nextjs" && "dark:invert", className)}
      width={16}
      height={16}
    />
  );
}
