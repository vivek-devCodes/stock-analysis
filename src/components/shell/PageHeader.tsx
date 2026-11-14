import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { clsx } from "@/lib/format";

/** Consistent page title row: icon tile, title, subtitle, and right-aligned actions. */
export function PageHeader({
  icon: Icon,
  tone = "text-accent",
  title,
  subtitle,
  actions,
  children,
}: {
  icon: LucideIcon;
  tone?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-card">
            <Icon className={clsx("h-5 w-5", tone)} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** Card wrapper with an icon title, used across the CRM pages. */
export function Card({
  icon: Icon,
  title,
  tone = "text-muted",
  action,
  className,
  children,
}: {
  icon?: LucideIcon;
  title?: string;
  tone?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={clsx("panel p-4", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && (
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
              {Icon && <Icon className={clsx("h-4 w-4", tone)} />}
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
