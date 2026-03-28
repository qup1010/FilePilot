import { SessionLauncher } from "@/components/session-launcher";

export default function HomePage() {
  return (
    <div className="flex-1 overflow-y-auto bg-surface scroll-smooth scrollbar-thin">
      <SessionLauncher />
    </div>
  );
}
