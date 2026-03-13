import { Header } from "@/components/header";
import { MainLayout } from "@/components/main-layout";
import { SandboxStoreProvider } from "@/lib/store/sandbox-store";
import { getSandboxSession } from "@/lib/chat-history";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const { chatId } = await params;
  const session = await getSandboxSession(chatId);
  return (
    <SandboxStoreProvider
      chatId={chatId}
      sandboxId={session?.sandboxId ?? null}
      previewUrl={session?.previewUrl ?? null}
      projectId={session?.projectId ?? null}
      projectOwnership={session?.projectOwnership ?? null}
      deploymentUrl={session?.deploymentUrl ?? null}
      sessionId={session?.agentSessionId ?? null}
    >
      <div className="flex h-screen flex-col overflow-hidden bg-white dark:bg-zinc-950">
        <Header />
        <MainLayout initialMessages={session?.messages ?? []} />
      </div>
    </SandboxStoreProvider>
  );
}
