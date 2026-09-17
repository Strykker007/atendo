/** Cabeçalho padrão das telas administrativas. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
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
    <div className="rounded-2xl border border-dashed border-surface-border bg-white p-12 text-center text-gray-500">
      <div className="mx-auto mb-3 text-gray-300 w-fit">{icon}</div>
      <p className="font-medium text-gray-700">{title}</p>
      <p className="text-sm">{text}</p>
    </div>
  );
}
