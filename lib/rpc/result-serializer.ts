import type { StandardRPCCustomJsonSerializer } from "@orpc/client/standard";
import { Result, type SerializedResult } from "better-result";
import { reconstructError } from "@/lib/errors";

const RESULT_TYPE_ID = 100;

function isResult(data: unknown): boolean {
  return (
    !!data &&
    typeof data === "object" &&
    typeof (data as { isOk?: unknown }).isOk === "function"
  );
}
export const resultSerializer: StandardRPCCustomJsonSerializer = {
  type: RESULT_TYPE_ID,
  condition: isResult,
  serialize: (
    result: Result<unknown, unknown>,
  ): SerializedResult<unknown, unknown> => {
    const serialized = Result.serialize(result);
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
