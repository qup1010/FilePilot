import { RuntimeStatus } from "@/components/runtime-status";
import { SessionLauncher } from "@/components/session-launcher";
import { SessionHistory } from "@/components/session-history";

export default function HomePage() {
  return (
    <div className="flex-1 overflow-y-auto bg-surface scroll-smooth pb-6 scrollbar-thin min-[1680px]:overflow-hidden min-[1680px]:pb-0">
      <div className="mx-auto grid min-w-0 w-full max-w-[1880px] gap-3 px-3 pt-3 min-[1680px]:h-full min-[1680px]:grid-cols-[minmax(0,1fr)_minmax(300px,340px)] min-[1680px]:items-stretch min-[1680px]:gap-3 min-[1680px]:px-4 min-[1680px]:pt-4">
        <section className="min-w-0 flex flex-col min-[1680px]:h-full min-[1680px]:min-h-0">
          <SessionLauncher />
        </section>
        <aside className="min-w-0 flex flex-col space-y-3 min-[1680px]:grid min-[1680px]:h-full min-[1680px]:min-h-0 min-[1680px]:grid-rows-[minmax(0,1fr)_auto] min-[1680px]:space-y-0">
          <SessionHistory maxItems={6} />
          <div className="min-[1680px]:mt-3 shrink-0">
            <RuntimeStatus />
          </div>
        </aside>
      </div>
    </div>
  );
}
