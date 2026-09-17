'use client';
import { useState } from 'react';
import { Plus, QrCode, ArrowLeftRight, RefreshCw, Trash2, Power, ShieldCheck, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNumbers, useConnectNumber, useUpdateNumber, useDeleteNumber, useUsage, type NumberItem } from '@/lib/hooks';
import { btnPrimary } from '@/components/ui/Modal';
import { CreateNumberModal, SwitchProviderModal } from '@/components/numbers/NumberDialogs';
import { QrModal } from '@/components/numbers/QrModal';

const STATUS: Record<string, { label: string; cls: string }> = {
  connected: { label: 'Conectado', cls: 'bg-brand' },
  pending_qr: { label: 'Aguardando QR', cls: 'bg-amber-500' },
  disconnected: { label: 'Desconectado', cls: 'bg-gray-400' },
  error: { label: 'Erro', cls: 'bg-red-500' },
};

export default function NumerosPage() {
  const numbers = useNumbers();
  const usage = useUsage();
  const connect = useConnectNumber();
  const update = useUpdateNumber();
  const remove = useDeleteNumber();
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState<NumberItem | null>(null);
  const [qr, setQr] = useState<{ id: string; initial?: string } | null>(null);

  const max = usage.data?.limits?.maxNumbers as number | undefined;
  const count = numbers.data?.filter((n) => n.isActive).length ?? 0;

  const afterConnect = (r: { id: string; qrCode?: string; provider: string }) => {
    if (r.provider === 'evolution') setQr({ id: r.id, initial: r.qrCode });
  };

  async function reconnect(n: NumberItem) {
    try {
      const r = await connect.mutateAsync(n.id);
      if (n.provider === 'evolution') setQr({ id: n.id, initial: r.qrCode });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao conectar');
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Números</h1>
            <p className="text-sm text-gray-500">
              Cada número é um canal de atendimento. {max !== undefined && <>Plano <b>{usage.data?.plan}</b>: {count}/{max} números.</>}
            </p>
          </div>
          <button onClick={() => setCreating(true)} disabled={max !== undefined && count >= max} className={btnPrimary}>
            <Plus size={16} className="inline mr-1 -mt-0.5" /> Novo número
          </button>
        </header>

        {numbers.data?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-surface-border bg-white p-12 text-center text-gray-500">
            <Smartphone size={36} className="mx-auto mb-3 text-gray-300" />
            <p className="font-medium text-gray-700">Nenhum número ainda</p>
            <p className="text-sm">Cadastre o primeiro número para começar a receber mensagens.</p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {numbers.data?.map((n) => {
            const st = STATUS[n.status] ?? STATUS.disconnected;
            return (
              <div key={n.id} className={cn('rounded-2xl bg-white border border-surface-border p-5 space-y-4', !n.isActive && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{n.label}</div>
                    <div className="text-sm text-gray-500">+{n.phone}</div>
                  </div>
                  <span className={cn('inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1', n.provider === 'meta' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700')}>
                    {n.provider === 'meta' ? <ShieldCheck size={13} /> : <QrCode size={13} />}
                    {n.provider === 'meta' ? 'Oficial' : 'Não-oficial'}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <span className={cn('w-2.5 h-2.5 rounded-full', st.cls)} />
                  <span className="text-gray-700">{st.label}</span>
                  {!n.isActive && <span className="text-xs text-gray-400">· desativado</span>}
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  {n.provider === 'evolution' && n.status !== 'connected' && (
                    <Action icon={<QrCode size={14} />} onClick={() => reconnect(n)} primary>Conectar (QR)</Action>
                  )}
                  {(n.provider === 'meta' || n.status === 'connected') && (
                    <Action icon={<RefreshCw size={14} />} onClick={() => reconnect(n)}>Revalidar</Action>
                  )}
                  <Action icon={<ArrowLeftRight size={14} />} onClick={() => setSwitching(n)}>Trocar provider</Action>
                  <Action icon={<Power size={14} />} onClick={() => update.mutate({ id: n.id, isActive: !n.isActive })}>{n.isActive ? 'Desativar' : 'Ativar'}</Action>
                  <Action icon={<Trash2 size={14} />} danger onClick={() => confirm(`Excluir "${n.label}"? As conversas deste número também serão removidas.`) && remove.mutate(n.id)}>Excluir</Action>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <CreateNumberModal open={creating} onClose={() => setCreating(false)} onDone={afterConnect} />
      <SwitchProviderModal number={switching} onClose={() => setSwitching(null)} onDone={afterConnect} />
      <QrModal numberId={qr?.id ?? null} initialQr={qr?.initial} onClose={() => setQr(null)} />
    </div>
  );
}

function Action({ icon, children, onClick, primary, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; primary?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 transition-colors',
        primary ? 'border-brand bg-brand text-white hover:bg-brand-hover' : danger ? 'border-surface-border text-red-600 hover:bg-red-50' : 'border-surface-border text-gray-700 hover:bg-surface-muted',
      )}
    >
      {icon} {children}
    </button>
  );
}
