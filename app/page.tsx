import { nanoid } from "nanoid";
import { Header } from "@/components/header";
import { MainLayout } from "@/components/main-layout";
import { SandboxStoreProvider } from "@/lib/store/sandbox-store";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <SandboxStoreProvider chatId={nanoid()}>
      <div className="flex h-screen flex-col overflow-hidden bg-white dark:bg-zinc-950">
        <Header />
        <MainLayout />
      </div>
    </SandboxStoreProvider>
  );
}
