import { RuntimeStatus } from "@/components/runtime-status";
import { SessionLauncher } from "@/components/session-launcher";
import { SessionHistory } from "@/components/session-history";

export default function HomePage() {
  return (
    <div className="flex-1 overflow-y-auto bg-surface scroll-smooth pb-6 scrollbar-thin">
      <div className="mx-auto flex min-w-0 w-full max-w-[1880px] flex-col gap-3 px-3 pt-3 min-[1440px]:gap-4 min-[1440px]:px-4 min-[1440px]:pt-4">
        <section className="min-w-0 flex flex-col">
          <SessionLauncher />
        </section>
        <section className="grid min-w-0 gap-3 min-[1440px]:grid-cols-[minmax(0,1fr)_minmax(280px,320px)] min-[1440px]:items-start">
          <div className="min-w-0">
            <SessionHistory maxItems={5} />
          </div>
          <div className="min-w-0 shrink-0">
            <RuntimeStatus />
          </div>
        </section>
      </div>
    </div>
  );
}
