import { Header } from "@/components/header";
import { MainLayout } from "@/components/main-layout";

export default function Page() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900">
      <Header />
      <MainLayout />
    </div>
  );
}
