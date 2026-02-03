import { TaggedError } from "better-result";
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "object" && err !== null) {
    return JSON.stringify(err);
  }
  return String(err);
}

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

export class FileNotFoundError extends TaggedError("FileNotFoundError")<{
  message: string;
  path: string;
}>() {}
export class PathValidationError extends TaggedError("PathValidationError")<{
  message: string;
  path: string;
}>() {}

export class ValidationError extends TaggedError("ValidationError")<{
  message: string;
  field?: string;
}>() {}
export class NetworkError extends TaggedError("NetworkError")<{
  message: string;
  url?: string;
  status?: number;
}>() {}

export type AppError =
  | SandboxError
  | SandboxNotFoundError
  | SetupError
  | FileNotFoundError
  | PathValidationError
  | ValidationError
  | NetworkError;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ERROR_REGISTRY: Record<string, new (props: any) => AppError> = {
  SandboxError,
  SandboxNotFoundError,
  SetupError,
  FileNotFoundError,
  PathValidationError,
  ValidationError,
  NetworkError,
};
export function reconstructError(obj: { _tag: string }): AppError | null {
  const ErrorClass = ERROR_REGISTRY[obj._tag];
  if (!ErrorClass) return null;
  return new ErrorClass(obj);
}
