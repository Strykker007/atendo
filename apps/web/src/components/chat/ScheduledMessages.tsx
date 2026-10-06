'use client';
import { useEffect, useState } from 'react';
import { AlarmClock, ChevronDown, ChevronRight, X, AlertTriangle } from 'lucide-react';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { TextWithVars } from '@/components/flows/TextWithVars';
import { usePersistedState } from '@/lib/persisted';
import { useScheduledMessages, useScheduleMessage, useCancelScheduledMessage, useCan, type ScheduledMessage } from '@/lib/hooks';

/**
 * Mensagens agendadas (docs/agendamento-de-mensagens.md).
 *
 * O horário escolhido é o do navegador de quem agenda; vai para a API em ISO (UTC) e o job de
 * 1 minuto envia pelo mesmo caminho do chat. As {{variáveis}} são resolvidas na hora do envio —
 * `{{saudacao}}` agendada para 20h sai "Boa noite".
 */

const pad = (n: number) => String(n).padStart(2, '0');
const dataLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const horaLocal = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Atalhos de horário: o caso comum é "daqui a pouco" ou "amanhã cedo". */
function atalhos(agora: Date): { rotulo: string; quando: Date }[] {
  const em = (min: number) => new Date(Math.ceil((agora.getTime() + min * 60_000) / 300_000) * 300_000);
  const amanha = (h: number) => { const d = new Date(agora); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d; };
  return [
    { rotulo: 'Em 1 hora', quando: em(60) },
    { rotulo: 'Em 3 horas', quando: em(180) },
    { rotulo: 'Amanhã 09:00', quando: amanha(9) },
    { rotulo: 'Amanhã 14:00', quando: amanha(14) },
  ];
}

export function quandoBR(iso: string) {
  const d = new Date(iso);
  const hoje = new Date();
  const amanha = new Date(); amanha.setDate(hoje.getDate() + 1);
  const dia = d.toDateString() === hoje.toDateString() ? 'hoje' : d.toDateString() === amanha.toDateString() ? 'amanhã'
    : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return `${dia} às ${horaLocal(d)}`;
}

export function ScheduleMessageModal({ open, onClose, conversationId, textoInicial, onAgendado }: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  /** o que estava escrito no campo vira a mensagem agendada */
  textoInicial: string;
  onAgendado?: () => void;
}) {
  const agendar = useScheduleMessage();
  const [texto, setTexto] = useState('');
  const [data, setData] = useState('');
  const [hora, setHora] = useState('');

  useEffect(() => {
    if (!open) return;
    const sugestao = atalhos(new Date())[0].quando;
    setTexto(textoInicial);
    setData(dataLocal(sugestao));
    setHora(horaLocal(sugestao));
  }, [open, textoInicial]);

  const quando = data && hora ? new Date(`${data}T${hora}:00`) : null;
  const noPassado = !!quando && quando.getTime() < Date.now() + 60_000;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!quando || noPassado || !texto.trim()) return;
    try {
      await agendar.mutateAsync({ conversationId, content: texto, scheduledFor: quando.toISOString() });
      toast.ok(`Agendada para ${quandoBR(quando.toISOString())}`);
      onAgendado?.();
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Agendar mensagem">
      <form onSubmit={salvar} className="space-y-4">
        <Field label="Mensagem" hint="As variáveis são preenchidas na hora do envio.">
          <TextWithVars value={texto} onChange={setTexto} vars={[]} flowVarsGroup={false} formatting maxLength={4096} required />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {atalhos(new Date()).map((a) => (
            <button key={a.rotulo} type="button" onClick={() => { setData(dataLocal(a.quando)); setHora(horaLocal(a.quando)); }} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-ink hover:bg-field">
              {a.rotulo}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data"><input type="date" className={inputCls} value={data} min={dataLocal(new Date())} onChange={(e) => setData(e.target.value)} required /></Field>
          <Field label="Hora"><input type="time" className={inputCls} value={hora} onChange={(e) => setHora(e.target.value)} required /></Field>
        </div>
        {noPassado && <p className="text-[12px] text-danger-ink">Escolha um horário pelo menos 1 minuto à frente.</p>}
        <p className="text-[11.5px] text-muted">Sai em seu nome, pelo número desta conversa. Se a conversa estiver encerrada na hora, ela é reaberta com você.</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" icon={<AlarmClock size={15} />} disabled={!quando || noPassado || !texto.trim()} loading={agendar.isPending} loadingText="Agendando…">Agendar</Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Faixa acima do campo: "2 mensagens agendadas", retrátil. Some quando não há nada. Falhadas
 * ficam visíveis (com o motivo) até alguém dispensar — mensagem que não saiu não pode sumir.
 */
export function ScheduledMessagesBar({ conversationId }: { conversationId: string }) {
  const lista = useScheduledMessages(conversationId).data ?? [];
  const cancelar = useCancelScheduledMessage();
  const podeCancelar = useCan('conversations.schedule_message');
  const [aberto, setAberto] = usePersistedState('agendadas-aberto', false);
  if (lista.length === 0) return null;

  const pendentes = lista.filter((s) => s.status === 'pending');
  const falhas = lista.length - pendentes.length;
  const remover = (s: ScheduledMessage) =>
    cancelar.mutateAsync({ conversationId, id: s.id }).then(() => toast.ok(s.status === 'pending' ? 'Agendamento cancelado' : 'Removida da lista')).catch(toast.err);

  return (
    <div className="border-t border-line bg-panel">
      <button type="button" onClick={() => setAberto(!aberto)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-muted hover:text-ink">
        {aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <AlarmClock size={13} className="text-accent-ink" />
        <span>
          {pendentes.length > 0 && <>{pendentes.length} {pendentes.length === 1 ? 'mensagem agendada' : 'mensagens agendadas'}{pendentes[0] && <> · próxima {quandoBR(pendentes[0].scheduledFor)}</>}</>}
          {falhas > 0 && <span className="text-danger-ink">{pendentes.length > 0 && ' · '}{falhas} não {falhas === 1 ? 'saiu' : 'saíram'}</span>}
        </span>
      </button>
      {aberto && (
        <ul className="max-h-48 overflow-y-auto scrollbar-thin pb-1.5">
          {lista.map((s) => (
            <li key={s.id} className="group flex items-start gap-2 pl-8 pr-2 py-1 hover:bg-field">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-faint">
                  {s.status === 'failed'
                    ? <span className="text-danger-ink inline-flex items-center gap-1"><AlertTriangle size={11} /> Não saiu ({quandoBR(s.scheduledFor)}): {s.error}</span>
                    : <>{quandoBR(s.scheduledFor)} · por {s.user.name}</>}
                </div>
                <div className="text-[12.5px] text-ink whitespace-pre-wrap line-clamp-2">{s.content || s.mediaName}</div>
              </div>
              {podeCancelar && <button type="button" onClick={() => void remover(s)} title={s.status === 'pending' ? 'Cancelar envio' : 'Dispensar'} className="text-faint hover:text-danger p-1 shrink-0">
                <X size={14} />
              </button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
