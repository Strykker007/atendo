'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, MessagesSquare, ShieldCheck, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { inputCls } from '@/components/ui/Modal';
import { internalMessagesInOrder, useAgents, useAuditInternalChats, useAuditInternalMessages, useCan } from '@/lib/hooks';

const dataHora = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Auditoria do chat interno (docs/chat-interno.md). Quem tem `internal_chat.audit` lê qualquer
 * conversa da equipe, direta ou em grupo. Ler aqui não marca como lida para os membros, e o
 * histórico não tem apagar nem editar.
 */
export default function ChatInternoAuditoriaPage() {
  const pode = useCan('internal_chat.audit');
  const agents = useAgents();
  const [userId, setUserId] = useState('');
  const chats = useAuditInternalChats(userId || null, pode);
  const [chatId, setChatId] = useState<string | null>(null);
  const aberta = chats.data?.find((c) => c.id === chatId) ?? null;
  const msgs = useAuditInternalMessages(aberta?.id ?? null);
  const lista = useMemo(() => internalMessagesInOrder(msgs.data), [msgs.data]);

  return (
    <PageShell width="max-w-5xl">
      <Link href="/configuracoes#empresa" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft size={14} /> Configurações</Link>
      <PageHeader title="Auditoria do chat interno" subtitle="Todas as conversas da equipe, diretas e em grupo, com o histórico completo." />

      {!pode ? (
        <Empty icon={<ShieldCheck size={28} />} title="Sem acesso" text="Peça a permissão “Auditar o chat interno da equipe” ao administrador." />
      ) : (
        <div className="grid md:grid-cols-[320px_1fr] gap-4 min-h-[60vh]">
          <div className="space-y-2">
            <select className={cn(inputCls)} value={userId} onChange={(e) => { setUserId(e.target.value); setChatId(null); }} aria-label="Filtrar por pessoa">
              <option value="">Todas as pessoas</option>
              {(agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.isActive ? '' : ' (inativo)'}</option>)}
            </select>
            {chats.isLoading ? <SkeletonRows /> : !chats.data?.length ? (
              <Empty icon={<MessagesSquare size={24} />} title="Nenhuma conversa" text="A equipe ainda não usou o chat interno." />
            ) : (
              <ul className="divide-y divide-line rounded-2xl border border-line bg-panel max-h-[70vh] overflow-y-auto">
                {chats.data.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setChatId(c.id)} className={cn('w-full text-left px-3 py-2.5 hover:bg-field', chatId === c.id && 'bg-accent-soft')}>
                      <span className="flex items-center gap-1.5">
                        {c.isGroup && <Users size={13} className="text-muted shrink-0" />}
                        <span className="truncate text-sm font-medium text-ink">{c.name}</span>
                        {c.deletedAt && <span className="shrink-0 rounded-full bg-danger-soft px-1.5 text-[10px] font-semibold text-danger-ink">apagado</span>}
                        <span className="ml-auto text-[11px] text-faint shrink-0 tnum">{c.messages ?? 0} msg</span>
                      </span>
                      <span className="block truncate text-[12px] text-muted">{c.isGroup ? c.members.map((m) => m.name).join(', ') : c.lastMessagePreview ?? 'Sem mensagens'}</span>
                      {c.lastMessageAt && <span className="block text-[11px] text-faint">{dataHora(c.lastMessageAt)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-panel flex flex-col min-h-0">
            {!aberta ? (
              <div className="flex-1 grid place-items-center p-8 text-sm text-muted">Escolha uma conversa para ler.</div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-line">
                  <p className="font-display font-semibold text-ink">{aberta.name}{aberta.deletedAt && <span className="ml-2 text-[12px] font-normal text-danger">· apagado em {dataHora(aberta.deletedAt)}</span>}</p>
                  <p className="text-[12px] text-muted">{aberta.members.map((m) => m.name + (m.active ? '' : ' (inativo)')).join(', ')}</p>
                </div>
                <div className="flex-1 overflow-y-auto max-h-[65vh] px-4 py-3 space-y-2">
                  {msgs.hasNextPage && (
                    <button type="button" onClick={() => void msgs.fetchNextPage()} disabled={msgs.isFetchingNextPage} className="mx-auto block text-[12px] text-accent hover:underline">
                      {msgs.isFetchingNextPage ? 'Carregando…' : 'Mensagens anteriores'}
                    </button>
                  )}
                  {msgs.isLoading ? <SkeletonRows /> : !lista.length ? <p className="text-sm text-muted">Sem mensagens.</p> : lista.map((m) => m.system ? (
                    // aviso do sistema: quem adicionou, tirou, renomeou ou apagou
                    <p key={m.id} className="text-[12px] text-muted italic"><span className="not-italic text-faint tnum">{dataHora(m.createdAt)}</span> {m.text}</p>
                  ) : (
                    <div key={m.id} className="text-sm">
                      <span className="text-[11.5px] text-faint tnum">{dataHora(m.createdAt)}</span>{' '}
                      <b className="text-ink">{m.authorName}</b>
                      {m.replyToId && (
                        <p className="mt-0.5 border-l-2 border-line pl-2 text-[12px] text-muted line-clamp-2">
                          {m.replyTo ? <>Em resposta a <b>{m.replyTo.authorName}</b>: {m.replyTo.text}</> : 'Em resposta a uma mensagem indisponível'}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words text-ink/90">{m.text}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
