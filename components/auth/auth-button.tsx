/**
 * Auth Button
 *
 * Renders either a sign-in button or user menu based on session state.
 * Use this as a drop-in component in your header/navbar.
 */

"use client";

import { useSession } from "./session-store";
import { SignInButton } from "./sign-in-button";
import { UserMenu } from "./user-menu";
import { Skeleton } from "@/components/ui/skeleton";

interface AuthButtonProps {
  /** Optional initial user from server-side session */
  initialUser?: Parameters<typeof UserMenu>[0]["user"] | null;
}

export function AuthButton({ initialUser }: AuthButtonProps) {
  const { initialized, loading, user } = useSession();

  // Use server-provided user until client state is initialized
  const currentUser = initialized ? user : initialUser;

  // Show skeleton while loading
  if (!initialized && !initialUser && loading) {
    return <Skeleton className="h-8 w-8 rounded-full" />;
  }

  if (currentUser) {
    return <UserMenu user={currentUser} />;
  }

  return <SignInButton />;
}
