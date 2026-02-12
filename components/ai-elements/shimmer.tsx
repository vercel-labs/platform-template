"use client";

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Shimmer({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex h-4 items-center rounded bg-zinc-800/70 px-2 text-[10px] font-medium uppercase tracking-wider text-zinc-300 animate-pulse",
        className,
      )}
      {...props}
    />
  );
}
