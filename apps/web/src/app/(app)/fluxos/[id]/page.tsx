'use client';
import { useParams, useRouter } from 'next/navigation';
import { FlowEditor } from '@/components/flows/FlowEditor';
import { useFlow, useCreateFlow, useUpdateFlow } from '@/lib/hooks';

export default function FluxoEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === 'novo';
  const flow = useFlow(isNew ? null : id);
  const create = useCreateFlow();
  const update = useUpdateFlow();

  if (!isNew && !flow.data) return <div className="flex-1 grid place-items-center text-sm text-muted">{flow.isError ? 'Fluxo não encontrado.' : 'Carregando fluxo…'}</div>;

  return (
    <FlowEditor
      key={flow.data?.id ?? 'novo'}
      flow={flow.data ?? {}}
      saving={create.isPending || update.isPending}
      onSave={async (f) => {
        if (isNew) {
          const created = await create.mutateAsync(f as any);
          router.replace(`/fluxos/${created.id}`);
        } else {
          await update.mutateAsync({ id, ...f });
        }
      }}
    />
  );
}
