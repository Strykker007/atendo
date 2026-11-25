'use client';
import { useEffect, useMemo, useState } from 'react';
import { BellRing, Search, UserRound, X } from 'lucide-react';
import { DEFAULT_TICKET_CLOSED_MESSAGE, DEFAULT_TICKET_OPENED_MESSAGE, TICKET_NOTICE_MAX, TICKET_NOTICE_VARS, TICKET_TEXT_MAX, renderTicketNotice } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useContactsList, useTicketWrite, type TicketOptions, type TicketRow } from '@/lib/hooks';

/** Reclamante do ticket (docs/tickets.md#reclamante). */
export type Reclamante = { id: string; name: string | null; phone: string };
export const nomeDoReclamante = (r: Reclamante) => r.name || r.phone;

/** Busca nos contatos que a pessoa enxerga (mesma lista da tela Contatos). */
export function ReclamantePicker({ value, onChange, autoFocus }: { value: Reclamante | null; onChange: (r: Reclamante | null) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const [aberto, setAberto] = useState(false);
  const busca = useContactsList(q.trim());
  const itens = busca.data?.pages[0]?.items.slice(0, 8) ?? [];
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 h-[38px] text-sm">
        <UserRound size={14} className="text-faint shrink-0" />
        <span className="flex-1 truncate text-ink">{nomeDoReclamante(value)}{value.name && <span className="text-faint"> · {value.phone}</span>}</span>
        <button type="button" onClick={() => onChange(null)} className="text-faint hover:text-ink" aria-label="Tirar reclamante"><X size={14} /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <label className={cn(inputCls, 'flex items-center gap-2')}>
        <Search size={14} className="text-faint shrink-0" />
        <input autoFocus={autoFocus} value={q} onChange={(e) => { setQ(e.target.value); setAberto(true); }} onFocus={() => setAberto(true)} onBlur={() => setTimeout(() => setAberto(false), 150)} placeholder="Nome ou telefone do contato" className="bg-transparent w-full focus:outline-none" />
      </label>
      {aberto && q.trim().length >= 2 && (
        <ul className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-line bg-panel shadow-lg py-1">
          {busca.isLoading && <li className="px-3 py-2 text-xs text-faint">Buscando…</li>}
          {!busca.isLoading && !itens.length && <li className="px-3 py-2 text-xs text-faint">Nenhum contato com esse nome ou telefone.</li>}
          {itens.map((c) => (
            <li key={c.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ id: c.id, name: c.name, phone: c.phone }); setQ(''); setAberto(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-field">
                {c.name || c.phone}{c.name && <span className="text-faint text-xs"> · {c.phone}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Variáveis do aviso, a partir do ticket (iguais às da API: `varsDoAviso`). */
const varsDe = (t: TicketRow) => ({ nome: t.requester?.name ?? '', numero: t.number, titulo: t.title, tipo: t.type?.name ?? '', setor: t.department?.name ?? '' });

/**
 * Resolver / cancelar com conclusão. Com reclamante e aviso ligado, mostra a mensagem pronta (do
 * modelo da empresa) para revisar — editar à mão para de acompanhar a conclusão.
 */
export function EncerrarModal({ t, status, opts, onClose }: { t: TicketRow; status: 'resolved' | 'canceled'; opts: TicketOptions; onClose: () => void }) {
  const w = useTicketWrite();
  const resolver = status === 'resolved';
  const [nota, setNota] = useState('');
  const temAviso = !!t.requester && t.notifyRequester;
  const [avisar, setAvisar] = useState(temAviso);
  const [editada, setEditada] = useState<string | null>(null);
  const pronta = useMemo(() => renderTicketNotice(opts.notices.closed, { ...varsDe(t), situacao: resolver ? 'resolvido' : 'cancelado', conclusao: nota }), [opts.notices.closed, t, resolver, nota]);
  const mensagem = editada ?? pronta;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await w.mutateAsync({ path: `/${t.id}/status`, body: { status, note: nota.trim() || undefined, ...(temAviso && { notify: avisar, ...(avisar && editada !== null && { message: editada }) }) } });
      toast.ok(resolver ? 'Ticket resolvido' : 'Ticket cancelado');
      // o aviso não derruba o encerramento: se não saiu, a linha do tempo diz por quê
      const aviso = r && 'events' in r ? [...r.events].reverse().find((x) => x.type === 'notice') : undefined;
      if (temAviso && avisar && aviso && (aviso.data as { ok?: boolean } | null)?.ok === false) toast.warn(`O aviso ao reclamante não saiu: ${(aviso.data as { error?: string }).error ?? 'erro no envio'}`);
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title={`${resolver ? 'Resolver' : 'Cancelar'} #${t.number}`} width="max-w-lg">
      <form onSubmit={salvar} className="space-y-4">
        <Field label={resolver ? 'O que foi feito' : 'Por que cancelar'} hint="Fica na linha do tempo do ticket.">
          <textarea className={cn(inputCls, 'min-h-[4.5rem]')} value={nota} maxLength={TICKET_TEXT_MAX} onChange={(e) => setNota(e.target.value)} autoFocus placeholder={resolver ? 'Ex.: Lâmpada trocada pelo zelador às 14h.' : 'Ex.: Pedido em duplicidade.'} />
        </Field>
        {t.requester && !t.notifyRequester && <p className="text-xs text-faint">O aviso ao reclamante ({nomeDoReclamante(t.requester)}) está desligado neste ticket.</p>}
        {temAviso && (
          <div className="rounded-lg border border-line p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-ink cursor-pointer">
              <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
              <BellRing size={14} /> Avisar {nomeDoReclamante(t.requester!)} no WhatsApp
            </label>
            {avisar && (
              <>
                <textarea className={cn(inputCls, 'min-h-[6rem] text-[13px]')} value={mensagem} maxLength={TICKET_NOTICE_MAX} onChange={(e) => setEditada(e.target.value)} aria-label="Mensagem ao reclamante" />
                <div className="flex items-center justify-between text-[11px] text-faint">
                  <span>{editada === null ? 'Do modelo da empresa — acompanha o que você escrever acima.' : 'Editada à mão.'}</span>
                  {editada !== null && <button type="button" className="underline hover:text-ink" onClick={() => setEditada(null)}>Voltar ao modelo</button>}
                </div>
              </>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Voltar</Button>
          <Button type="submit" variant={resolver ? 'success' : 'danger'} loading={w.isPending} disabled={avisar && temAviso && !mensagem.trim()}>{resolver ? 'Resolver' : 'Cancelar ticket'}{temAviso && avisar ? ' e avisar' : ''}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Modelos dos avisos (gestão): abertura e encerramento, com as variáveis e uma prévia. */
export function AvisosModal({ opts, onClose }: { opts: TicketOptions; onClose: () => void }) {
  const w = useTicketWrite();
  const [f, setF] = useState({ opened: opts.notices.opened, closed: opts.notices.closed });
  useEffect(() => setF({ opened: opts.notices.opened, closed: opts.notices.closed }), [opts.notices.opened, opts.notices.closed]);
  const exemplo = { nome: 'Maria', numero: 128, titulo: 'Vazamento na garagem', tipo: 'Manutenção', setor: 'Zeladoria', situacao: 'resolvido', conclusao: 'Encanamento trocado pela equipe às 15h.' };
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      // igual ao padrão = guarda nulo (se o padrão do sistema melhorar, a empresa acompanha)
      await w.mutateAsync({ path: '/notice-templates', method: 'PATCH', body: { openedMessage: f.opened.trim() === DEFAULT_TICKET_OPENED_MESSAGE ? null : f.opened, closedMessage: f.closed.trim() === DEFAULT_TICKET_CLOSED_MESSAGE ? null : f.closed } });
      toast.ok('Avisos salvos');
      onClose();
    } catch (err) { toast.err(err); }
  }
  const campo = (k: 'opened' | 'closed', titulo: string, quando: string, padrao: string) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{titulo}</span>
        {f[k].trim() !== padrao && <button type="button" className="text-[11px] text-muted underline hover:text-ink" onClick={() => setF({ ...f, [k]: padrao })}>Usar o padrão</button>}
      </div>
      <p className="text-[11px] text-faint">{quando}</p>
      <textarea className={cn(inputCls, 'min-h-[5rem] text-[13px]')} value={f[k]} maxLength={TICKET_NOTICE_MAX} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      <p className="rounded-lg bg-field px-3 py-2 text-[12.5px] text-ink whitespace-pre-wrap"><span className="text-faint text-[11px] block">Prévia</span>{renderTicketNotice(f[k], exemplo)}</p>
    </div>
  );
  return (
    <Modal open onClose={onClose} title="Avisos ao reclamante" width="max-w-xl">
      <form onSubmit={salvar} className="space-y-4">
        <p className="text-xs text-muted">Mensagens que o contato recebe no WhatsApp sobre o chamado dele. Cada ticket pode desligar o aviso. Segue as regras de todo envio automático: quem pediu para sair não recebe, e na API oficial (Meta) só sai dentro das 24 horas da última mensagem do contato.</p>
        <div className="flex flex-wrap gap-1">
          {Object.entries(TICKET_NOTICE_VARS).map(([k, l]) => <code key={k} title={l} className="rounded bg-field px-1.5 py-0.5 text-[11px] text-muted">{`{{${k}}}`}</code>)}
        </div>
        {campo('opened', 'Na abertura', 'Quando o ticket é aberto pelo painel ou pela conversa (o aberto por fluxo ou agente de IA não avisa: ele mesmo responde ao contato).', DEFAULT_TICKET_OPENED_MESSAGE)}
        {campo('closed', 'No encerramento', 'Ao resolver ou cancelar. Quem encerra revisa a mensagem antes de enviar. Linha com variável vazia some (ex.: sem conclusão).', DEFAULT_TICKET_CLOSED_MESSAGE)}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={w.isPending}>Salvar</Button></div>
      </form>
    </Modal>
  );
}
