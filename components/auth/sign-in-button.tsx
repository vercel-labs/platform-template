
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { redirectToSignIn } from "@/lib/auth/client";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface SignInButtonProps {
  className?: string;
}

export function SignInButton({ className }: SignInButtonProps) {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      className={cn("cursor-pointer", className)}
      onClick={async () => {
        setLoading(true);
        await redirectToSignIn();
      }}
      size="sm"
      disabled={loading}
    >
      {loading ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading...
        </>
      ) : (
        <>
          <VercelIcon />
          Sign in with Vercel
        </>
      )}
    </Button>
  );
}

function VercelIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height={9}
      viewBox="0 0 75 65"
    >
      <title>Vercel Logo</title>
      <path d="M37.59.25l36.95 64H.64l36.95-64z" />
    </svg>
  );
}
