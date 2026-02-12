"use client";

import { useSession } from "./session-store";
import { UserMenu } from "./user-menu";
import { Skeleton } from "@/components/ui/skeleton";

interface AuthButtonProps {
  initialUser?: Parameters<typeof UserMenu>[0]["user"] | null;
}

export function AuthButton({ initialUser }: AuthButtonProps) {
  const { initialized, loading, user } = useSession();

  const currentUser = initialized ? user : initialUser;

  if (!initialized && !initialUser && loading) {
    return <Skeleton className="h-8 w-8 rounded-full" />;
  }

  if (currentUser) {
    return <UserMenu user={currentUser} />;
  }

  return null;
}
