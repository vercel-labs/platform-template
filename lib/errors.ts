import { TaggedError } from "better-result";

/** Convert unknown error to string message */
export const errorMessage = (err: unknown): string =>
  err instanceof Error
    ? err.message
    : typeof err === "object" && err !== null
      ? JSON.stringify(err)
      : String(err);

// Sandbox errors
export class SandboxError extends TaggedError("SandboxError")<{
  message: string;
  sandboxId?: string;
}>() {}
export class SandboxNotFoundError extends TaggedError("SandboxNotFoundError")<{
  message: string;
  sandboxId: string;
}>() {}
export class SetupError extends TaggedError("SetupError")<{
  message: string;
  step: string;
}>() {}

// File errors
export class FileNotFoundError extends TaggedError("FileNotFoundError")<{
  message: string;
  path: string;
}>() {}
export class PathValidationError extends TaggedError("PathValidationError")<{
  message: string;
  path: string;
}>() {}

// General errors
export class ValidationError extends TaggedError("ValidationError")<{
  message: string;
  field?: string;
}>() {}
export class NetworkError extends TaggedError("NetworkError")<{
  message: string;
  url?: string;
  status?: number;
}>() {}

// All error types
export type AppError =
  | SandboxError
  | SandboxNotFoundError
  | SetupError
  | FileNotFoundError
  | PathValidationError
  | ValidationError
  | NetworkError;

// Registry for deserialization
export const ERROR_REGISTRY: Record<string, new (props: any) => AppError> = {
  SandboxError,
  SandboxNotFoundError,
  SetupError,
  FileNotFoundError,
  PathValidationError,
  ValidationError,
  NetworkError,
};

export function reconstructError(obj: { _tag: string }): AppError | null {
  const Ctor = ERROR_REGISTRY[obj._tag];
  return Ctor ? new Ctor(obj as any) : null;
}
