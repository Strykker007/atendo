'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { FLOW_VERSION_CONFLICT, FlowEditor } from '@/components/flows/FlowEditor';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { useFlow, useCreateFlow, useUpdateFlow } from '@/lib/hooks';

export default function FluxoEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === 'novo';
  const flow = useFlow(isNew ? null : id);
  const create = useCreateFlow();
  const update = useUpdateFlow();
  /**
   * Versão que o editor carregou (optimistic locking). Só muda ao carregar/recarregar e depois de
   * salvar — o refetch em segundo plano não pode "adiantar" a versão por baixo das alterações locais.
   */
  const version = useRef<number | undefined>(undefined);
  const [reloads, setReloads] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    if (flow.data && version.current === undefined) version.current = flow.data.version;
  }, [flow.data]);

  if (!isNew && !flow.data) return <div className="flex-1 grid place-items-center text-sm text-muted">{flow.isError ? 'Fluxo não encontrado.' : 'Carregando fluxo…'}</div>;

  /** Descarta as alterações locais e abre a versão atual do banco. */
  const reload = async () => {
    setReloading(true);
    try {
      const fresh = await flow.refetch();
      version.current = fresh.data?.version;
      setReloads((n) => n + 1); // nova chave = editor remonta com o desenho do banco
      setConflict(false);
    } finally {
      setReloading(false);
    }
  };

  return (
    <>
      <FlowEditor
        key={`${flow.data?.id ?? 'novo'}-${reloads}`}
        flow={flow.data ?? {}}
        saving={create.isPending || update.isPending}
        onSave={async (f) => {
          if (isNew) {
            const created = await create.mutateAsync(f as any);
            router.replace(`/fluxos/${created.id}`);
            return;
          }
          try {
            const saved = await update.mutateAsync({ id, ...f, version: version.current ?? flow.data?.version });
            version.current = saved.version;
          } catch (err) {
            if (err instanceof ApiError && err.code === FLOW_VERSION_CONFLICT) setConflict(true);
            throw err;
          }
        }}
      />
      <Modal open={conflict} onClose={() => setConflict(false)} title="Fluxo alterado">
        <div className="space-y-4">
          <p className="text-sm text-ink">Este fluxo foi alterado por outra pessoa ou pelo sistema. Recarregue para ver a versão atual.</p>
          <p className="text-[12px] text-muted">Recarregar descarta as alterações que você fez aqui e ainda não foram salvas.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConflict(false)}>Agora não</Button>
            <Button icon={<RefreshCw size={14} />} loading={reloading} onClick={reload}>Recarregar</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
