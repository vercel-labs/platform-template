"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Edit3,
  ExternalLink,
  Eye,
  Globe,
  Lock,
  Rocket,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { rpc } from "@/lib/rpc/client";
import type { LogEvent } from "@/lib/rpc/procedures/deploy";

type TextLogEvent = Extract<LogEvent, { text: string }>;

function isTextLog(log: LogEvent): log is TextLogEvent {
  return "text" in log;
}

type DeploymentState =
  | { status: "idle" }
  | { status: "deploying"; progress: string }
  | { status: "building"; deploymentId: string; url?: string; logs: LogEvent[] }
  | { status: "ready"; url: string }
  | { status: "error"; message: string; logs?: LogEvent[] };

type ViewState = "main" | "domain" | "visibility";
type VisibilityOption = "public" | "private";

interface UseDeploymentOptions {
  sandboxId: string;
}

function useDeployment({ sandboxId }: UseDeploymentOptions) {
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [readyState, setReadyState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const abortRef = useRef(false);

  useEffect(() => {
    if (!deploymentId) return;

    abortRef.current = false;

    const streamLogs = async () => {
      try {
        const iterator = await rpc.deploy.logs({ deploymentId });

        for await (const entry of iterator) {
          if (abortRef.current) break;

          if (entry.type === "state" && entry.readyState) {
            setReadyState(entry.readyState);
          }

          if (entry.type === "done" && entry.readyState) {
            setReadyState(entry.readyState);
          }

          if (entry.type === "error") {
            setError(entry.message || "Build failed");
          }

          setLogs((prev) => [...prev, entry]);
        }
      } catch (err) {
        if (!abortRef.current) {
          console.error("Log stream error:", err);
        }
      }
    };

    streamLogs();

    return () => {
      abortRef.current = true;
    };
  }, [deploymentId]);

  const startDeployment = useCallback(async () => {
    setError(null);
    setLogs([]);
    setReadyState(null);
    setIsDeploying(true);

    try {
      const result = await rpc.deploy.files({
        sandboxId,
        projectId,
      });

      if (result.isOk()) {
        setDeploymentUrl(result.value.url);
        setDeploymentId(result.value.id);
        setProjectId(result.value.projectId);
        return result.value;
      } else {
        const message = result.error.message;
        setError(message);
        throw new Error(message);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Deployment failed";
      setError(message);
      throw e;
    } finally {
      setIsDeploying(false);
    }
  }, [sandboxId, projectId]);

  const getDeploymentState = useCallback((): DeploymentState => {
    if (error) {
      return {
        status: "error",
        message: error,
        logs: logs.length > 0 ? logs : undefined,
      };
    }

    if (isDeploying) {
      return { status: "deploying", progress: "Starting deployment..." };
    }

    if (deploymentId && readyState === "READY" && deploymentUrl) {
      return { status: "ready", url: deploymentUrl };
    }

    if (deploymentId && (readyState === "ERROR" || readyState === "CANCELED")) {
      return { status: "error", message: "Deployment failed", logs };
    }

    if (deploymentId) {
      return {
        status: "building",
        deploymentId,
        url: deploymentUrl || undefined,
        logs,
      };
    }

    return { status: "idle" };
  }, [isDeploying, deploymentId, deploymentUrl, readyState, logs, error]);

  const reset = useCallback(() => {
    abortRef.current = true;
    setDeploymentId(null);
    setDeploymentUrl(null);
    setLogs([]);
    setReadyState(null);
    setError(null);
  }, []);

  return { state: getDeploymentState(), startDeployment, reset };
}

interface DeployPopoverProps {
  sandboxId: string | null;
  disabled?: boolean;
}

export function DeployPopover({ sandboxId, disabled }: DeployPopoverProps) {
  const [viewState, setViewState] = useState<ViewState>("main");
  const [customDomain, setCustomDomain] = useState<string>("");
  const [visibility, setVisibility] = useState<VisibilityOption>("public");
  const [tempVisibility, setTempVisibility] =
    useState<VisibilityOption>("public");
  const [open, setOpen] = useState(false);
  const visibilityId = useId();
  const logsEndRef = useRef<HTMLDivElement>(null);

  const { state, startDeployment, reset } = useDeployment({
    sandboxId: sandboxId || "",
  });

  useEffect(() => {
    if (state.status === "building") {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [state]);

  const canDeploy = sandboxId && !disabled;

  const handleDeploy = useCallback(async () => {
    if (!canDeploy) return;
    await startDeployment();
  }, [startDeployment, canDeploy]);

  const handleBack = () => {
    setViewState("main");
  };

  const handleSaveVisibility = () => {
    setVisibility(tempVisibility);
    setViewState("main");
  };

  const handleCancelVisibility = () => {
    setTempVisibility(visibility);
    setViewState("main");
  };

  const handleAddDomain = () => {
    setViewState("main");
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (
      !newOpen &&
      state.status !== "building" &&
      state.status !== "deploying"
    ) {
      reset();
    }
  };

  if (viewState === "domain") {
    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={!canDeploy}>
            <Rocket className="h-4 w-4" />
            Deploy
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-0">
          <div className="flex items-center gap-2 border-b p-2">
            <Button
              aria-label="Back"
              className="size-8"
              onClick={handleBack}
              size="icon"
              variant="ghost"
            >
              <ChevronLeft className="h-3" />
            </Button>
            <h3 className="font-medium">Add a Custom Domain</h3>
          </div>

          <div className="space-y-4 p-4">
            <p className="text-muted-foreground text-sm">
              Assign a custom vercel.app subdomain to make your project more
              memorable.
            </p>

            <div className="relative">
              <Input
                className="w-full pr-21"
                onChange={(e) => setCustomDomain(e.target.value)}
                placeholder="your-domain"
                value={customDomain}
              />
              <span className="-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground text-sm">
                .vercel.app
              </span>
            </div>

            <Button className="w-full" onClick={handleAddDomain}>
              Add Domain
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  if (viewState === "visibility") {
    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={!canDeploy}>
            <Rocket className="h-4 w-4" />
            Deploy
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-0">
          <div className="flex items-center gap-2 border-b p-2">
            <Button
              aria-label="Back"
              className="size-8"
              onClick={handleBack}
              size="icon"
              variant="ghost"
            >
              <ChevronLeft className="h-3" />
            </Button>
            <h3 className="font-medium">Visibility</h3>
          </div>

          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <Label
                className="text-muted-foreground text-sm"
                htmlFor={visibilityId}
              >
                Visibility
              </Label>
              <Select
                onValueChange={(value: VisibilityOption) =>
                  setTempVisibility(value)
                }
                value={tempVisibility}
              >
                <SelectTrigger className="w-full" id={visibilityId}>
                  <div className="flex items-center gap-2">
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      <span>Public</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="private">
                    <div className="flex items-center gap-2">
                      <Lock className="h-4 w-4" />
                      <span>Private</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={handleCancelVisibility}
                variant="outline"
              >
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleSaveVisibility}>
                Save
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={!canDeploy}>
          <Rocket className="h-4 w-4" />
          Deploy
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[28rem] p-0">
        <div className="space-y-4 p-4">
          <div>
            <h3 className="mb-2 font-semibold">Deploy to Vercel</h3>
            <p className="text-muted-foreground text-sm">
              Deploy this project to Vercel. You&apos;ll get a production URL
              for your app.
            </p>
          </div>

          {state.status === "idle" && (
            <div className="space-y-2">
              <Button
                className="w-full justify-between shadow-none"
                onClick={() => setViewState("domain")}
                type="button"
                variant="secondary"
              >
                <div className="flex items-center gap-3">
                  <Edit3 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Customize Domain</span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Button>

              <Button
                className="w-full justify-between shadow-none"
                onClick={() => setViewState("visibility")}
                type="button"
                variant="secondary"
              >
                <div className="flex items-center gap-3">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Visibility</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-sm capitalize">
                    {visibility}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Button>
            </div>
          )}

          {state.status === "building" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
                Building...
              </div>
              <div className="h-48 overflow-y-auto rounded-md bg-zinc-950 p-3 font-mono text-xs">
{state.logs.filter(isTextLog).map((log) => (
                    <div
                      key={`${log.timestamp}-${log.text.slice(0, 20)}`}
                      className={
                        log.type === "stderr"
                          ? "text-red-400"
                          : log.type === "command"
                            ? "text-blue-400"
                            : "text-zinc-300"
                      }
                    >
                      {log.text}
                    </div>
                  ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}

          {state.status === "error" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-destructive">
                <div className="h-2 w-2 rounded-full bg-destructive" />
                {state.message}
              </div>
              {state.logs && state.logs.length > 0 && (
                <div className="h-48 overflow-y-auto rounded-md bg-zinc-950 p-3 font-mono text-xs">
                  {state.logs.filter(isTextLog).map((log) => (
                    <div
                      key={`${log.timestamp}-${log.text.slice(0, 20)}`}
                      className={
                        log.type === "stderr"
                          ? "text-red-400"
                          : log.type === "command"
                            ? "text-blue-400"
                            : "text-zinc-300"
                      }
                    >
                      {log.text}
                    </div>
                  ))}
                </div>
              )}
              <Button className="w-full" variant="outline" onClick={reset}>
                Try Again
              </Button>
            </div>
          )}

          {state.status === "ready" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                Deployment complete
              </div>
              <Button
                className="w-full"
                onClick={() =>
                  window.open(
                    `https://${state.url}`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                View Deployment
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          ) : state.status === "idle" ? (
            <Button className="w-full" onClick={handleDeploy}>
              Deploy to Production
            </Button>
          ) : state.status === "deploying" ? (
            <Button className="w-full" disabled>
              {state.progress}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
