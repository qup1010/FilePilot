import Link from "next/link";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { href: "/", label: "新建整理" },
  { href: "/history", label: "历史记录" },
] as const;

export function AppFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">File Organizer Desktop MVP</p>
          <h1>{title}</h1>
          <p className="subtitle">{subtitle}</p>
        </div>
        <nav className="nav-tabs" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="nav-tab">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="content-grid">{children}</main>
    </div>
  );
}
