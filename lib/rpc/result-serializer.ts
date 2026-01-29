import type { StandardRPCCustomJsonSerializer } from "@orpc/client/standard";
import { Result, type SerializedResult } from "better-result";
import { reconstructError } from "@/lib/errors";

// Custom type ID for Result serialization (must be unique across all custom serializers)
const RESULT_TYPE_ID = 100;

function isResult(data: unknown): boolean {
  return (
    !!data &&
    typeof data === "object" &&
    typeof (data as { isOk?: unknown }).isOk === "function"
  );
}

/**
 * Custom JSON serializer for Result types over oRPC.
 * Preserves TaggedError _tag for client-side error reconstruction.
 */
export const resultSerializer: StandardRPCCustomJsonSerializer = {
  type: RESULT_TYPE_ID,
  condition: isResult,
  serialize: (
    result: Result<unknown, unknown>,
  ): SerializedResult<unknown, unknown> => {
    const serialized = Result.serialize(result);
    // Preserve _tag for TaggedError reconstruction on client
    if (serialized.status === "error") {
      const error = (result as { error?: { _tag?: string; message?: string } })
        .error;
      if (error?._tag) {
        return {
          status: "error",
          error: { _tag: error._tag, message: error.message, ...error },
        };
      }
    }
    return serialized;
  },
  deserialize: (data: SerializedResult<unknown, unknown>) => {
    // Reconstruct TaggedError from _tag if present
    if (data.status === "error") {
      const error = data.error as { _tag?: string } | undefined;
      if (error?._tag) {
        const reconstructed = reconstructError(error as { _tag: string });
        if (reconstructed) return Result.err(reconstructed);
      }
    }
    return Result.deserialize(data);
  },
};

export const customJsonSerializers = [resultSerializer];
