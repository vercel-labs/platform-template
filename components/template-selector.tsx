"use client";

import { useId } from "react";
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
        <span className="grid text-left">
          {TEMPLATES.map((template) => (
            <span
              key={template.id}
              className={cn(
                "col-start-1 row-start-1",
                template.id !== selectedTemplate.id && "invisible",
              )}
            >
              {template.name}
            </span>
          ))}
        </span>
        <ChevronDown className="h-4 w-4 text-zinc-500" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {TEMPLATES.map((template) => (
          <DropdownMenuItem
            key={template.id}
            onClick={() => setTemplateId(template.id)}
            className={cn(
              "flex items-center gap-2 cursor-pointer",
              template.id === templateId && "bg-zinc-100 dark:bg-zinc-800",
            )}
          >
            <TemplateIcon templateId={template.id} />
            <span className="font-medium">{template.name}</span>
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
  const id = useId();

  switch (templateId) {
    case "nextjs":
      return (
        <svg
          className={cn("h-4 w-4 dark:invert", className)}
          viewBox="0 0 180 180"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-labelledby={`${id}-nextjs-title`}
        >
          <title id={`${id}-nextjs-title`}>Next.js</title>
          <mask
            id={`${id}-mask`}
            style={{ maskType: "alpha" }}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="180"
            height="180"
          >
            <circle cx="90" cy="90" r="90" fill="black" />
          </mask>
          <g mask={`url(#${id}-mask)`}>
            <circle cx="90" cy="90" r="90" fill="black" />
            <path
              d="M149.508 157.52L69.142 54H54V125.97H66.1136V69.3836L139.999 164.845C143.333 162.614 146.509 160.165 149.508 157.52Z"
              fill={`url(#${id}-gradient0)`}
            />
            <rect
              x="115"
              y="54"
              width="12"
              height="72"
              fill={`url(#${id}-gradient1)`}
            />
          </g>
          <defs>
            <linearGradient
              id={`${id}-gradient0`}
              x1="109"
              y1="116.5"
              x2="144.5"
              y2="160.5"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="white" />
              <stop offset="1" stopColor="white" stopOpacity="0" />
            </linearGradient>
            <linearGradient
              id={`${id}-gradient1`}
              x1="121"
              y1="54"
              x2="120.799"
              y2="106.875"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="white" />
              <stop offset="1" stopColor="white" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      );
    case "vite":
      return (
        <svg
          className={cn("h-4 w-4", className)}
          viewBox="0 0 410 404"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-labelledby={`${id}-vite-title`}
        >
          <title id={`${id}-vite-title`}>Vite</title>
          <path
            d="M399.641 59.5246L215.643 388.545C211.844 395.338 202.084 395.378 198.228 388.618L10.5817 59.5563C6.38087 52.1896 12.6802 43.2665 21.0281 44.7586L205.223 77.6824C206.398 77.8924 207.601 77.8904 208.776 77.6763L389.119 44.8058C397.439 43.2894 403.768 52.1434 399.641 59.5246Z"
            fill={`url(#${id}-vite-gradient0)`}
          />
          <path
            d="M292.965 1.5744L156.801 28.2552C154.563 28.6937 152.906 30.5903 152.771 32.8664L144.395 174.33C144.198 177.662 147.258 180.248 150.51 179.498L188.42 170.749C191.967 169.931 195.172 173.055 194.443 176.622L183.18 231.775C182.422 235.487 185.907 238.661 189.532 237.56L212.947 230.446C216.577 229.344 220.065 232.527 219.297 236.242L201.398 322.875C200.278 328.294 207.486 331.249 210.492 326.603L212.5 323.5L323.454 102.072C325.312 98.3645 322.108 94.137 318.036 94.9228L279.014 102.454C275.347 103.161 272.227 99.746 273.262 96.1583L298.731 7.86689C299.767 4.27314 296.636 0.855181 292.965 1.5744Z"
            fill={`url(#${id}-vite-gradient1)`}
          />
          <defs>
            <linearGradient
              id={`${id}-vite-gradient0`}
              x1="6.00017"
              y1="32.9999"
              x2="235"
              y2="344"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#41D1FF" />
              <stop offset="1" stopColor="#BD34FE" />
            </linearGradient>
            <linearGradient
              id={`${id}-vite-gradient1`}
              x1="194.651"
              y1="8.81818"
              x2="236.076"
              y2="292.989"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#FFBD4F" />
              <stop offset="1" stopColor="#FF980E" />
            </linearGradient>
          </defs>
        </svg>
      );
    case "tanstack-start":
      return (
        <img
          src="/tanstack-start.png"
          alt="TanStack Start"
          className={cn("h-4 w-4", className)}
          width={16}
          height={16}
        />
      );
  }
}
