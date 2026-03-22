import { RuntimeStatus } from "@/components/runtime-status";
import { SessionLauncher } from "@/components/session-launcher";
import { SessionHistory } from "@/components/session-history";

export default function HomePage() {
  return (
    <div className="flex-1 overflow-y-auto bg-surface scroll-smooth pb-24 scrollbar-thin">
      <div className="max-w-5xl mx-auto w-full px-8 pt-16 space-y-14">
        <SessionLauncher />
        
        <SessionHistory />

        <RuntimeStatus />
      </div>
    </div>
  );
}
