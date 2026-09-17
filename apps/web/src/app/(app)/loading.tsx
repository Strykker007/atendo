import { Skeleton, SkeletonRows } from '@/components/ui/Skeleton';

/** Next mostra isto instantaneamente enquanto a rota do módulo carrega/compila. */
export default function Loading() {
  return (
    <div className="flex-1 overflow-hidden">
      <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <SkeletonRows rows={5} />
      </div>
    </div>
  );
}
