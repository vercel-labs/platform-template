import { Header } from "@/components/header";
import { MainLayout } from "@/components/main-layout";

export default function Page() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white dark:bg-zinc-950">
      <Header />
      <MainLayout />
    </div>
  );
}
