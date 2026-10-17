'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmClock, MessageSquare, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { useUI } from '@/lib/store';
import { useAgents, useAllScheduledMessages, useCan, useCancelScheduledById, useNumbers, type ScheduledFilters, type ScheduledMessageRow } from '@/lib/hooks';

const VAZIO: ScheduledFilters = { status: 'pending', userId: '', numberId: '', from: '', to: '', q: '', page: 1 };
const STATUS: Record<ScheduledMessageRow['status'], [string, string]> = {
  pending: ['Agendada', 'bg-accent-soft text-accent-ink'],
  failed: ['Não enviada', 'bg-danger-soft text-danger-ink'],
  sent: ['Enviada', 'bg-ok-soft text-ok'],
  cancelled: ['Cancelada', 'bg-field text-muted'],
};
const selCls = 'rounded-lg bg-field px-2 h-9 text-[13px] text-ink';
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Mensagens agendadas de todas as conversas (docs/agendamento-de-mensagens.md#tela-agendadas).
 * Atendente vê as que ele agendou; quem vê todas as conversas vê as da equipe e filtra por autor.
 */
export default function AgendadasPage() {
  const [f, setF] = useState<ScheduledFilters>(VAZIO);
  const set = (p: Partial<ScheduledFilters>) => setF((x) => ({ ...x, page: 1, ...p }));
  const lista = useAllScheduledMessages(f);
  const verTodas = useCan('conversations.view_all');
  const podeCancelar = useCan('conversations.schedule_message');
  const agents = useAgents();
  const numbers = useNumbers();
  const cancelar = useCancelScheduledById();
  const [cancelando, setCancelando] = useState<ScheduledMessageRow | null>(null);
  const setConversation = useUI((s) => s.setConversation);
  const router = useRouter();
  const d = lista.data;
  const paginas = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const filtrando = JSON.stringify({ ...f, page: 1 }) !== JSON.stringify(VAZIO);
  const abrir = (r: ScheduledMessageRow) => { setConversation(r.conversationId); router.push('/conversas'); };

  return (
    <PageShell width="max-w-5xl">
      <PageHeader title="Mensagens agendadas" subtitle={verTodas ? 'As mensagens que a equipe agendou nas conversas. Agende pelo relógio abaixo do campo de mensagem.' : 'As mensagens que você agendou nas conversas. Agende pelo relógio abaixo do campo de mensagem.'} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Contato, telefone ou texto" aria-label="Buscar" className={cn(selCls, 'w-full pl-8')} />
        </div>
        <select value={f.status} onChange={(e) => set({ status: e.target.value as ScheduledFilters['status'] })} className={selCls} aria-label="Status">
          <option value="pending">Agendadas (a enviar)</option>
          <option value="failed">Não enviadas</option>
          <option value="sent">Enviadas</option>
          <option value="cancelled">Canceladas</option>
          <option value="all">Todos os status</option>
        </select>
        {verTodas && (
          <select value={f.userId} onChange={(e) => set({ userId: e.target.value })} className={selCls} aria-label="Quem agendou">
            <option value="">Toda a equipe</option>
            {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {(numbers.data?.length ?? 0) > 1 && (
          <select value={f.numberId} onChange={(e) => set({ numberId: e.target.value })} className={selCls} aria-label="Número">
            <option value="">Todos os números</option>
            {numbers.data?.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
        )}
        <label className="flex items-center gap-1 text-[12px] text-muted">De <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className={selCls} aria-label="De" /></label>
        <label className="flex items-center gap-1 text-[12px] text-muted">até <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} className={selCls} aria-label="Até" /></label>
        {filtrando && <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => setF(VAZIO)}>Limpar</Button>}
      </div>

      {lista.isLoading && <SkeletonRows rows={4} />}
      {d && d.rows.length === 0 && <Empty icon={<AlarmClock size={36} />} title={filtrando ? 'Nada com esses filtros' : 'Nenhuma mensagem agendada'} text={filtrando ? 'Mude os filtros ou limpe para ver todas.' : 'Na conversa, use o relógio abaixo do campo de mensagem para agendar um envio.'} />}
      {d && d.rows.length > 0 && (
        <div className="rounded-2xl bg-panel border border-line divide-y divide-line">
          {d.rows.map((r) => {
            const [rotulo, cls] = STATUS[r.status];
            return (
              <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                <div className="w-36 shrink-0">
                  <div className="text-[12.5px] font-medium text-ink tnum">{quando(r.scheduledFor)}</div>
                  <span className={cn('inline-block mt-1 text-[10.5px] font-semibold rounded-full px-2 py-0.5', cls)}>{rotulo}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-[12.5px]">
                    <button type="button" onClick={() => abrir(r)} className="font-medium text-ink hover:text-accent-ink truncate max-w-[16rem]" title="Abrir conversa">{r.contact.name || r.contact.phone}</button>
                    {r.contact.name && <span className="text-faint tnum">{r.contact.phone}</span>}
                    {r.conversation.number && <span className="text-muted">· {r.conversation.number.label}</span>}
                    <span className="text-muted">· por {r.user.name}</span>
                  </div>
                  <p className="text-sm text-ink/90 whitespace-pre-wrap break-words line-clamp-3 mt-0.5">{r.content || (r.mediaName ? `📎 ${r.mediaName}` : '(anexo)')}</p>
                  {r.status === 'failed' && r.error && <p className="text-xs text-danger-ink mt-1">{r.error}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" icon={<MessageSquare size={13} />} onClick={() => abrir(r)}>Conversa</Button>
                  {podeCancelar && (r.status === 'pending' || r.status === 'failed') && (
                    <Button size="sm" variant="ghost" className="text-danger" icon={<X size={13} />} onClick={() => setCancelando(r)}>{r.status === 'pending' ? 'Cancelar' : 'Dispensar'}</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {d && paginas > 1 && (
        <div className="flex items-center justify-end gap-2 text-[12px]">
          <span className="text-muted mr-auto tnum">{d.total} mensagens</span>
          <Button size="sm" variant="ghost" disabled={f.page <= 1} onClick={() => setF((x) => ({ ...x, page: x.page - 1 }))}>Anterior</Button>
          <span className="text-muted tnum">{f.page} / {paginas}</span>
          <Button size="sm" variant="ghost" disabled={f.page >= paginas} onClick={() => setF((x) => ({ ...x, page: x.page + 1 }))}>Próxima</Button>
        </div>
      )}

      <ConfirmDialog
        open={!!cancelando}
        onClose={() => setCancelando(null)}
        title={cancelando?.status === 'failed' ? 'Dispensar aviso' : 'Cancelar mensagem agendada'}
        danger={cancelando?.status === 'pending'}
        confirmLabel={cancelando?.status === 'failed' ? 'Dispensar' : 'Cancelar envio'}
        text={cancelando?.status === 'failed' ? 'A mensagem não foi enviada e sai desta lista.' : `A mensagem para ${cancelando?.contact.name || cancelando?.contact.phone} em ${cancelando ? quando(cancelando.scheduledFor) : ''} não será enviada.`}
        onConfirm={async () => {
          if (!cancelando) return;
          try { await cancelar.mutateAsync(cancelando); toast.ok(cancelando.status === 'failed' ? 'Aviso dispensado' : 'Envio cancelado'); }
          catch (err) { toast.err(err); throw err; }
        }}
      />
    </PageShell>
  );
}
