import { cn } from '@/lib/utils';

/** Bloco cinza pulsante — usado enquanto dados carregam. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-gray-200/80', className)} />;
}

/** Lista de linhas (tabelas, listas) */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('rounded-2xl bg-white border border-surface-border divide-y divide-surface-border', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <Skeleton className="w-3.5 h-3.5 rounded-full" />
          <Skeleton className="h-4 flex-1 max-w-48" />
          <Skeleton className="h-3 w-20 ml-auto" />
        </div>
      ))}
    </div>
  );
}

/** Cards em grade (números, medidores) */
export function SkeletonCards({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-4 md:grid-cols-2', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-white border border-surface-border p-5 space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-2 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Linhas da lista de conversas */
export function SkeletonConversations({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-3 py-3 flex gap-3 border-b border-surface-border/60">
          <Skeleton className="w-11 h-11 rounded-full shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
