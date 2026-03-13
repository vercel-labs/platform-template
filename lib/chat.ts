import type { UIMessageStreamWriter } from "ai";
import {
  getAgent,
  isValidAgent,
  getDefaultAgent,
} from "@/lib/agents";
import {
  isValidTemplate,
  getTemplate,
  DEFAULT_TEMPLATE_ID,
  type TemplateId,
} from "@/lib/templates";
import { getSandboxSession } from "@/lib/chat-history";
import {
  createOrchestratorStream,
  type BuildAppResult,
} from "@/lib/agents/orchestrator-agent";
import type { ChatMessage } from "@/lib/types";

export interface ChatStreamParams {
  prompt: string;
  chatId: string;
  agentId?: string;
  templateId?: string;
  sessionId?: string;
}

/** Metadata collected during the chat stream for persistence. */
export interface ChatStreamResult {
  sandboxId?: string;
  previewUrl?: string;
  agentSessionId?: string;
  /** Existing session data carried through to avoid a second Redis read. */
  existingSession?: {
    projectId?: string;
    projectOwnership?: "partner" | "user";
    deploymentUrl?: string;
  };
}

/**
 * Runs the chat logic, writing AI SDK UI message stream chunks to the provided writer.
 * Called from inside `createUIMessageStream`'s `execute` callback.
 * Returns metadata about the session (sandboxId, previewUrl) for persistence.
 */
export async function runChat(
  writer: UIMessageStreamWriter,
  params: ChatStreamParams,
): Promise<ChatStreamResult> {
  const { prompt, chatId, agentId, templateId } = params;

  const agent =
    agentId && isValidAgent(agentId)
      ? getAgent(agentId)
      : getDefaultAgent();

  const resolvedTemplateId: TemplateId =
    templateId && isValidTemplate(templateId)
      ? (templateId as TemplateId)
      : DEFAULT_TEMPLATE_ID;
  const template = getTemplate(resolvedTemplateId);

  // Load existing session by chatId
  const existingSession = await getSandboxSession(chatId);
  const history: ChatMessage[] = existingSession?.messages ?? [];

  const orchestratorResult = createOrchestratorStream({
    prompt,
    history,
    writer,
    agent,
    template,
    templateId: resolvedTemplateId,
    existingSession: existingSession ?? undefined,
  });

  writer.merge(orchestratorResult.toUIMessageStream());

  // Collect result — if BuildApp ran, its execute already handled everything
  const toolResults = await orchestratorResult.staticToolResults;
  const buildResult = toolResults.find(
    (r) => r.toolName === "BuildApp",
  )?.output;

  return {
    sandboxId: buildResult?.sandboxId ?? existingSession?.sandboxId,
    previewUrl: buildResult?.previewUrl ?? existingSession?.previewUrl,
    agentSessionId:
      buildResult?.agentSessionId ?? existingSession?.agentSessionId,
    existingSession: existingSession
      ? {
          projectId: existingSession.projectId,
          projectOwnership: existingSession.projectOwnership,
          deploymentUrl: existingSession.deploymentUrl,
        }
      : undefined,
  };
}
