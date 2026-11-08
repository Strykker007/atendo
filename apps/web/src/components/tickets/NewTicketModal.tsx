'use client';
import { useMemo, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL, TICKET_TEXT_MAX, TICKET_TITLE_MAX, type TicketPriority } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { DateInput } from '@/components/ui/DatePicker';
import { toast } from '@/components/ui/Toast';
import { useUI } from '@/lib/store';
import { useTicketWrite, type TicketOptions } from '@/lib/hooks';
import { CamposDoTipo } from './TicketTypes';

export const hojeYmd = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
/** "AAAA-MM-DD" → fim do dia em Brasília (prazo e retomada valem o dia inteiro) */
export const fimDoDia = (ymd: string) => `${ymd}T23:59:00-03:00`;

/** Aberto de dentro da conversa: já sai ligado a ela e ao momento (mensagem) escolhido. */
export interface TicketOrigin {
  conversationId: string;
  contato: string;
  /** mensagem de onde nasce; sem ela, vale a última da conversa */
  messageId?: string;
  /** prévia da mensagem, para a pessoa ver de onde está abrindo */
  trecho?: string;
}

/** Pessoas: responsável (um) + participantes (quantos precisar — adm, portaria, concierge…). */
function SeletorPessoas({ opts, responsavel, participantes, onResponsavel, onParticipantes, setor }: {
  opts: TicketOptions; responsavel: string; participantes: string[]; setor: string;
  onResponsavel: (id: string) => void; onParticipantes: (ids: string[]) => void;
}) {
  // quem é do setor escolhido aparece primeiro
  const ordem = useMemo(() => [...opts.users].sort((a, b) => Number(b.departmentIds.includes(setor)) - Number(a.departmentIds.includes(setor)) || a.name.localeCompare(b.name)), [opts.users, setor]);
  const livres = ordem.filter((u) => u.id !== responsavel && !participantes.includes(u.id));
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label="Responsável">
        <select className={inputCls} value={responsavel} onChange={(e) => { onResponsavel(e.target.value); onParticipantes(participantes.filter((p) => p !== e.target.value)); }}>
          <option value="">Ninguém ainda (o setor assume)</option>
          {ordem.map((u) => <option key={u.id} value={u.id}>{u.name}{setor && u.departmentIds.includes(setor) ? ' · do setor' : ''}</option>)}
        </select>
      </Field>
      <Field label="Atuam junto">
        <div className="space-y-1.5">
          {participantes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {participantes.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-field px-2 py-0.5 text-xs">
                  {opts.users.find((u) => u.id === id)?.name ?? '—'}
                  <button type="button" onClick={() => onParticipantes(participantes.filter((p) => p !== id))} aria-label="Tirar"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <select className={inputCls} value="" onChange={(e) => e.target.value && onParticipantes([...participantes, e.target.value])}>
            <option value="">＋ Incluir pessoa…</option>
            {livres.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </Field>
    </div>
  );
}

/**
 * Novo ticket (docs/tickets.md). Da tela de Tickets, pode ligar à conversa aberta no painel; de
 * dentro da conversa (`origem`), já vem ligado a ela e à mensagem — o ticket guarda o retrato das
 * últimas mensagens e a conversa ganha o marco "Ticket #N aberto".
 */
export function NewTicketModal({ opts, onClose, onCriado, origem }: { opts: TicketOptions; onClose: () => void; onCriado: (id: string, number: number) => void; origem?: TicketOrigin }) {
  const w = useTicketWrite();
  const conversa = useUI((s) => s.conversationId);
  const [f, setF] = useState({ title: '', description: '', priority: 'normal' as TicketPriority, departmentId: '', responsibleId: '', participantIds: [] as string[], dueAt: '', vincular: false, typeId: '', fields: {} as Record<string, string> });
  const tipos = opts.types.filter((t) => t.isActive);
  const tipo = tipos.find((t) => t.id === f.typeId) ?? null;
  /** escolher o tipo traz setor, prioridade e prazo padrão dele (dá para mudar depois) */
  const escolherTipo = (id: string) => {
    const t = tipos.find((x) => x.id === id);
    const prazo = t?.dueDays ? new Date(Date.now() + t.dueDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : '';
    setF((x) => ({ ...x, typeId: id, fields: {}, ...(t && { priority: t.priority, departmentId: t.departmentId ?? x.departmentId, dueAt: prazo || x.dueAt, title: x.title || t.name }) }));
  };
  const ligacao = origem
    ? { conversationId: origem.conversationId, ...(origem.messageId && { messageId: origem.messageId }) }
    : f.vincular && conversa ? { conversationId: conversa } : {};
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await w.mutateAsync({
        path: '', body: {
          title: f.title, description: f.description || undefined, priority: f.priority, departmentId: f.departmentId || undefined,
          responsibleId: f.responsibleId || undefined, participantIds: f.participantIds, dueAt: f.dueAt ? fimDoDia(f.dueAt) : undefined,
          ...ligacao,
          ...(tipo && { typeId: tipo.id, fields: f.fields }),
        },
      });
      if ('id' in r && 'number' in r) { toast.ok(`Ticket #${r.number} aberto`); onCriado(r.id, r.number); }
    } catch (err) { toast.err(err); }
  }
  return (
    <Modal open onClose={onClose} title={origem ? `Novo ticket da conversa com ${origem.contato}` : 'Novo ticket'} width="max-w-2xl">
      <form onSubmit={salvar} className="space-y-3">
        {origem && (
          <div className="rounded-lg bg-field px-3 py-2 text-xs text-muted space-y-1">
            <p className="flex items-center gap-1.5 font-semibold text-ink"><MessageSquare size={12} /> {origem.messageId ? 'A partir desta mensagem' : 'A partir da conversa'}</p>
            {origem.trecho && <p className="italic line-clamp-3 break-words">“{origem.trecho}”</p>}
            <p>O ticket guarda as últimas mensagens até aqui e a conversa ganha um marco com o número dele.</p>
          </div>
        )}
        {tipos.length > 0 && (
          <Field label="Tipo">
            <select className={inputCls} value={f.typeId} onChange={(e) => escolherTipo(e.target.value)}>
              <option value="">Sem tipo (livre)</option>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="O que precisa"><input className={inputCls} value={f.title} maxLength={TICKET_TITLE_MAX} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex.: Trocar lâmpada do hall do bloco B" required minLength={3} autoFocus /></Field>
        <Field label="Detalhes"><textarea className={cn(inputCls, 'min-h-[5rem]')} value={f.description} maxLength={TICKET_TEXT_MAX} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Onde, quem pediu, o que já foi feito…" /></Field>
        {tipo && <CamposDoTipo fields={tipo.fields} values={f.fields} onChange={(fields) => setF((x) => ({ ...x, fields }))} />}
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Setor">
            <select className={inputCls} value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>
              <option value="">Sem setor</option>
              {opts.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Prioridade">
            <select className={inputCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TicketPriority })}>
              {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p]}</option>)}
            </select>
          </Field>
          <Field label="Prazo"><DateInput value={f.dueAt} min={hojeYmd()} clearable onChange={(dueAt) => setF({ ...f, dueAt })} aria-label="Prazo" /></Field>
        </div>
        <SeletorPessoas opts={opts} setor={f.departmentId} responsavel={f.responsibleId} participantes={f.participantIds}
          onResponsavel={(responsibleId) => setF((x) => ({ ...x, responsibleId }))} onParticipantes={(participantIds) => setF((x) => ({ ...x, participantIds }))} />
        <p className="text-[11px] text-faint">Sem responsável, o ticket fica para quem atende o setor. Quem você incluir recebe o aviso na hora.</p>
        {!origem && conversa && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.vincular} onChange={(e) => setF({ ...f, vincular: e.target.checked })} /> Ligar ao atendimento aberto nas conversas</label>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={w.isPending}>Abrir ticket</Button></div>
      </form>
    </Modal>
  );
}
