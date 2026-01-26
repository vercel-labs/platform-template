"use client";

import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Panel({ className, children, ...props }: PanelProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface PanelHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function PanelHeader({ className, children, ...props }: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface PanelContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function PanelContent({ className, children, ...props }: PanelContentProps) {
  return (
    <div className={cn("flex-1 overflow-y-auto overflow-x-hidden p-4", className)} {...props}>
      {children}
    </div>
  );
}
