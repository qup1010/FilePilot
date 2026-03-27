import { SessionLauncher } from "@/components/session-launcher";

export default function HomePage() {
  return (
    <div className="flex-1 overflow-y-auto bg-surface scroll-smooth pb-8 scrollbar-thin sm:pb-10 lg:pb-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 pt-4 sm:pt-6 lg:pt-8 xl:pt-12">
        <SessionLauncher />
      </div>
    </div>
  );
}
