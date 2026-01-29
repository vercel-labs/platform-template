"use client";

import type { User } from "@/lib/auth";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { redirectToSignOut } from "@/lib/auth/client";
import { useSession } from "./session-store";
import { ExternalLink, LogOut } from "lucide-react";

interface UserMenuProps {
  user: User;
}

export function UserMenu({ user }: UserMenuProps) {
  const refresh = useSession((s) => s.refresh);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center cursor-pointer rounded-full overflow-hidden focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {user.avatar ? (
            <img
              alt={user.username}
              className="bg-zinc-200 rounded-full"
              height={32}
              width={32}
              src={`${user.avatar}&s=72`}
            />
          ) : (
            <div className="bg-zinc-200 rounded-full w-8 h-8" />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-64 p-2" align="end">
        <header className="p-2 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center justify-between text-sm font-medium">
            <span className="truncate">{user.name ?? user.username}</span>
            <Badge variant="secondary" className="ml-2 capitalize text-xs">
              {user.plan}
            </Badge>
          </div>
          {user.email && (
            <div className="text-xs text-zinc-500 truncate">{user.email}</div>
          )}
        </header>

        <div className="py-1">
          <a
            className="flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            href="https://vercel.com/dashboard"
            rel="noopener noreferrer"
            target="_blank"
          >
            <span>Vercel Dashboard</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>

          <button
            className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
            onClick={async () => {
              await redirectToSignOut();
              refresh();
            }}
            type="button"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
