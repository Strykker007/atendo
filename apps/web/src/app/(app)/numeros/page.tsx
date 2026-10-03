'use client';
import { useState } from 'react';
import { Plus, QrCode, ArrowLeftRight, RefreshCw, Trash2, Power, ShieldCheck, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useCan, useNumbers, useConnectNumber, useUpdateNumber, useDeleteNumber, useUsage, type NumberItem } from '@/lib/hooks';
import { Button } from '@/components/ui/Button';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { CreateNumberModal, SwitchProviderModal } from '@/components/numbers/NumberDialogs';
import { SendingCard } from '@/components/numbers/SendingCard';
import { QrModal } from '@/components/numbers/QrModal';
import { ConfirmDialog } from '@/components/ui/Confirm';

const STATUS: Record<string, { label: string; cls: string }> = {
  connected: { label: 'Conectado', cls: 'bg-ok' },
  pending_qr: { label: 'Aguardando QR', cls: 'bg-warn' },
  disconnected: { label: 'Desconectado', cls: 'bg-faint' },
  error: { label: 'Erro', cls: 'bg-danger' },
};

export default function NumerosPage() {
  // a API já recusava sem esta permissão; a tela é que continuava oferecendo o botão
  const podeGerenciar = useCan('numbers.manage');
  const numbers = useNumbers();
  const usage = useUsage();
  const connect = useConnectNumber();
  const update = useUpdateNumber();
  const remove = useDeleteNumber();
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState<NumberItem | null>(null);
  const [qr, setQr] = useState<{ id: string; initial?: string } | null>(null);
  const [deleting, setDeleting] = useState<NumberItem | null>(null);

  const max = usage.data?.limits?.maxNumbers as number | undefined;
  const count = numbers.data?.filter((n) => n.isActive).length ?? 0;

  const [busyId, setBusyId] = useState<string | null>(null); // qual card está com ação em andamento

  const afterConnect = (r: { id: string; qrCode?: string; provider: string }) => {
    if (r.provider === 'evolution') setQr({ id: r.id, initial: r.qrCode });
  };

  async function reconnect(n: NumberItem) {
    setBusyId(n.id);
    // Evolution: abre o modal na hora em "Gerando QR…" — o QR chega quando a API responder
    if (n.provider === 'evolution') setQr({ id: n.id });
    try {
      const r = await connect.mutateAsync(n.id);
      if (n.provider === 'evolution') setQr({ id: n.id, initial: r.qrCode });
      else toast.ok(r.status === 'connected' ? 'Credenciais válidas' : 'Não foi possível validar');
    } catch (err) {
      if (n.provider === 'evolution') setQr(null);
      toast.err(err);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(n: NumberItem) {
    setBusyId(n.id);
    try {
      await update.mutateAsync({ id: n.id, isActive: !n.isActive });
      toast.ok(n.isActive ? 'Número desativado' : 'Número ativado');
    } catch (err) {
      toast.err(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Números</h1>
            <p className="text-sm text-muted">
              Cada número é um canal de atendimento. {max !== undefined && <>Plano <b>{usage.data?.plan}</b>: {count}/{max} números.</>}
            </p>
          </div>
          {podeGerenciar && <Button onClick={() => setCreating(true)} disabled={max !== undefined && count >= max} icon={<Plus size={16} />}>Novo número</Button>}
        </header>

        {numbers.isLoading && <SkeletonCards count={2} />}
        {numbers.data?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line bg-panel p-12 text-center text-muted">
            <Smartphone size={36} className="mx-auto mb-3 text-faint" />
            <p className="font-medium text-ink">Nenhum número ainda</p>
            <p className="text-sm">Cadastre o primeiro número para começar a receber mensagens.</p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {numbers.data?.map((n) => {
            const st = STATUS[n.status] ?? STATUS.disconnected;
            return (
              <div key={n.id} className={cn('rounded-2xl bg-panel border border-line p-4 space-y-3', !n.isActive && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{n.label}</div>
                    <div className="text-sm text-muted">+{n.phone}</div>
                  </div>
                  <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1', n.provider === 'meta' ? 'bg-meta-soft text-meta-ink' : 'bg-evo-soft text-evo-ink')}>
                    {n.provider === 'meta' ? <ShieldCheck size={13} /> : <QrCode size={13} />}
                    {n.provider === 'meta' ? 'Oficial' : 'Não-oficial'}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <span className={cn('w-2.5 h-2.5 rounded-full', st.cls)} />
                  <span className="text-ink">{st.label}</span>
                  {!n.isActive && <span className="text-xs text-faint">· desativado</span>}
                </div>

                {n.isActive && <SendingCard number={n} />}

                <div className="flex flex-wrap gap-2">
                  {n.provider === 'evolution' && n.status !== 'connected' && (
                    <Button size="sm" icon={<QrCode size={14} />} onClick={() => reconnect(n)} loading={busyId === n.id && connect.isPending} loadingText="Gerando QR…">Conectar (QR)</Button>
                  )}
                  {(n.provider === 'meta' || n.status === 'connected') && (
                    <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => reconnect(n)} loading={busyId === n.id && connect.isPending} loadingText="Validando…">Revalidar</Button>
                  )}
                  {podeGerenciar && <>
                    <Button size="sm" variant="ghost" icon={<ArrowLeftRight size={14} />} onClick={() => setSwitching(n)} disabled={busyId === n.id}>Trocar provider</Button>
                    <Button size="sm" variant="ghost" icon={<Power size={14} />} onClick={() => toggleActive(n)} loading={busyId === n.id && update.isPending}>{n.isActive ? 'Desativar' : 'Ativar'}</Button>
                    <Button size="sm" variant="subtle" icon={<Trash2 size={14} />} onClick={() => setDeleting(n)} disabled={busyId === n.id}>Excluir</Button>
                  </>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <CreateNumberModal open={creating} onClose={() => setCreating(false)} onDone={afterConnect} />
      <SwitchProviderModal number={switching} onClose={() => setSwitching(null)} onDone={afterConnect} />
      <QrModal numberId={qr?.id ?? null} initialQr={qr?.initial} onClose={() => setQr(null)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir número"
        danger
        confirmLabel="Excluir"
        text={`"${deleting?.label}" será desconectado e todas as conversas dele serão removidas. Isso não pode ser desfeito.`}
        onConfirm={async () => { if (!deleting) return; try { await remove.mutateAsync(deleting.id); toast.ok('Número excluído'); } catch (err) { toast.err(err); throw err; } }}
      />
    </div>
  );
}

