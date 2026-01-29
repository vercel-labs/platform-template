import type { UIMessageChunk } from "ai";
import type { StreamChunk } from "./types";
import type { DataPartPayload } from "@/lib/types";

export function toUIMessageChunk(
  chunk: StreamChunk,
  partId: string,
): UIMessageChunk<unknown, DataPartPayload> | null {
  switch (chunk.type) {
    case "text-delta":
      return {
        type: "text-delta",
        id: partId,
        delta: chunk.text,
      };

    case "reasoning-delta":
      return {
        type: "reasoning-delta",
        id: `reasoning-${partId}`,
        delta: chunk.text,
      };

    case "tool-start":
      return {
        type: "tool-input-start",
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
      };

    case "tool-input-delta":
      return {
        type: "tool-input-delta",
        toolCallId: chunk.toolCallId,
        inputTextDelta: chunk.input,
      };

    case "tool-result":
      if (chunk.isError) {
        return {
          type: "tool-output-error",
          toolCallId: chunk.toolCallId,
          errorText: chunk.output,
        };
      }
      return {
        type: "tool-output-available",
        toolCallId: chunk.toolCallId,
        output: chunk.output,
      };

    case "data":
      return {
        type: `data-${chunk.dataType}`,
        data: chunk.data,
      } as UIMessageChunk<unknown, DataPartPayload>;

    case "error":
      return {
        type: "error",
        errorText: chunk.message,
      };

    case "message-start":
    case "message-end":
      return null;

    default:
      return null;
  }
}

export function createAgentStream(
  chunks: AsyncIterable<StreamChunk>,
  generatePartId: () => string = () => crypto.randomUUID(),
): ReadableStream<UIMessageChunk<unknown, DataPartPayload>> {
  let currentTextPartId = generatePartId();
  let currentReasoningPartId = generatePartId();
  let sentTextStart = false;
  let sentReasoningStart = false;

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of chunks) {
          if (chunk.type === "text-delta" && !sentTextStart) {
            controller.enqueue({
              type: "text-start",
              id: currentTextPartId,
            });
            sentTextStart = true;
          }

          if (chunk.type === "reasoning-delta" && !sentReasoningStart) {
            controller.enqueue({
              type: "reasoning-start",
              id: currentReasoningPartId,
            });
            sentReasoningStart = true;
          }

          if (chunk.type === "tool-start") {
            if (sentTextStart) {
              controller.enqueue({
                type: "text-end",
                id: currentTextPartId,
              });
              currentTextPartId = generatePartId();
              sentTextStart = false;
            }
            if (sentReasoningStart) {
              controller.enqueue({
                type: "reasoning-end",
                id: currentReasoningPartId,
              });
              currentReasoningPartId = generatePartId();
              sentReasoningStart = false;
            }
          }

          const uiChunk = toUIMessageChunk(chunk, currentTextPartId);
          if (uiChunk) {
            controller.enqueue(uiChunk);
          }
        }

        if (sentTextStart) {
          controller.enqueue({
            type: "text-end",
            id: currentTextPartId,
          });
        }
        if (sentReasoningStart) {
          controller.enqueue({
            type: "reasoning-end",
            id: currentReasoningPartId,
          });
        }

        controller.close();
      } catch (error) {
        controller.enqueue({
          type: "error",
          errorText: error instanceof Error ? error.message : String(error),
        });
        controller.close();
      }
    },
  });
}
