/** Cabeçalho padrão das telas administrativas. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function PageShell({ children, width = 'max-w-5xl' }: { children: React.ReactNode; width?: string }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className={`${width} mx-auto p-6 md:p-8 space-y-6`}>{children}</div>
    </div>
  );
}

export function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-panel p-12 text-center text-muted">
      <div className="mx-auto mb-3 text-faint w-fit">{icon}</div>
      <p className="font-medium text-ink">{title}</p>
      <p className="text-sm">{text}</p>
    </div>
  );
}
