import { Header } from "@/components/header";
import { MainLayout } from "@/components/main-layout";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sandboxId?: string }>;
}) {
  const { sandboxId } = await searchParams;
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white dark:bg-zinc-950">
      <Header />
      <MainLayout hasSession={!!sandboxId} />
    </div>
  );
}
