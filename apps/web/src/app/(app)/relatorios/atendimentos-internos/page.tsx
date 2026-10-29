'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, EyeOff, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { inputCls } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { useAgents, useCan, useInternalCloseAudit } from '@/lib/hooks';
import { useUI } from '@/lib/store';

/**
 * Relatórios → Atendimentos internos (docs/06-modelo-de-dados.md#encerramento-interno): conversa
 * que não é atendimento de cliente — gestor falando com a equipe, fornecedor, teste — e por isso
 * fica fora de todos os relatórios. Aqui se confere quem usou e quando: o registro não muda.
 * Morava em Configurações → Encerramento; é consulta, não configuração.
 * Só com `profiles.manage` (por padrão o Administrador) — a mesma regra da API (`GET /audit-logs`).
 */

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** início do dia local → ISO (a API recebe instantes; `to` exclusivo) */
const inicio = (dia: string) => new Date(`${dia}T00:00:00`).toISOString();

const PERIODOS = [
  { id: 'hoje', label: 'Hoje', de: () => ymd(new Date()) },
  { id: '7d', label: '7 dias', de: () => { const d = new Date(); d.setDate(d.getDate() - 6); return ymd(d); } },
  { id: '30d', label: '30 dias', de: () => { const d = new Date(); d.setDate(d.getDate() - 29); return ymd(d); } },
  { id: 'mes', label: 'Este mês', de: () => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), 1)); } },
  { id: 'tudo', label: 'Tudo', de: () => null },
] as const;
type Periodo = (typeof PERIODOS)[number]['id'];

export default function AtendimentosInternosPage() {
  const pode = useCan('profiles.manage');
  const router = useRouter();
  const setConversation = useUI((s) => s.setConversation);
  const agents = useAgents();
  const [periodo, setPeriodo] = useState<Periodo>('30d');
  const [actorId, setActorId] = useState('');
  const [page, setPage] = useState(1);
  const de = PERIODOS.find((p) => p.id === periodo)!.de();
  const audit = useInternalCloseAudit(pode, page, { from: de ? inicio(de) : undefined, actorId: actorId || undefined });
  const d = audit.data;
  const paginas = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const abrir = (conversationId: string) => { setConversation(conversationId); router.push('/conversas'); };

  if (!pode) return <PageShell><Empty icon={<EyeOff size={28} />} title="Sem acesso" text="Peça ao administrador a permissão de gerenciar perfis de acesso." /></PageShell>;
  return (
    <PageShell width="max-w-4xl">
      <PageHeader
        title="Atendimentos internos"
        subtitle="Conversas que não são atendimento ao público (gestor com a equipe, fornecedor, teste): não entram em nenhum relatório. Aqui fica quem encerrou assim e quando — o registro não pode ser alterado."
        action={<Link href="/relatorios" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Relatórios</Link>}
      />

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <div className="inline-flex rounded-lg border border-line p-0.5 text-[12.5px]">
          {PERIODOS.map((p) => (
            <button key={p.id} type="button" onClick={() => { setPeriodo(p.id); setPage(1); }}
              className={cn('px-2.5 py-1 rounded-md font-medium', periodo === p.id ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-ink')}>
              {p.label}
            </button>
          ))}
        </div>
        <select className={cn(inputCls, 'w-auto')} value={actorId} onChange={(e) => { setActorId(e.target.value); setPage(1); }} aria-label="Quem encerrou">
          <option value="">Toda a equipe</option>
          {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {d && <span className="ml-auto text-sm text-muted tnum">{d.total} atendimento{d.total === 1 ? '' : 's'} interno{d.total === 1 ? '' : 's'}</span>}
      </div>

      <div className="mt-3">
        {audit.isLoading && <SkeletonRows />}
        {d && d.rows.length === 0 && <Empty icon={<EyeOff size={24} />} title="Nenhum atendimento interno" text="Ninguém encerrou como interno neste período." />}
        {d && d.rows.length > 0 && (
          <ul className="rounded-xl border border-line bg-panel divide-y divide-line text-[13px]">
            {d.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="text-muted tnum">{new Date(r.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span className="text-ink font-medium">{r.actorName ?? '(sistema)'}</span>
                <span className="text-muted">encerrou</span>
                <span className="text-ink truncate max-w-[16rem]">{r.contactName ?? '(contato excluído)'}</span>
                {r.data?.reason && <span className="text-muted">· {r.data.reason}</span>}
                {r.data?.bulk && <span className="text-faint">· em massa</span>}
                <button type="button" onClick={() => abrir(r.entityId)} className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink" title="Abrir a conversa">
                  <MessageSquare size={13} /> Abrir
                </button>
              </li>
            ))}
          </ul>
        )}
        {d && paginas > 1 && (
          <div className="flex items-center justify-end gap-2 text-[12px] mt-2">
            <Button type="button" size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
            <span className="text-muted">{page} / {paginas}</span>
            <Button type="button" size="sm" variant="ghost" disabled={page >= paginas} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
          </div>
        )}
      </div>
    </PageShell>
  );
}
