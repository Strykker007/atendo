'use client';
import { ArrowRightLeft, CheckCircle2, Hand, RotateCcw, Undo2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useConversationEvents, type ConversationEvent } from '@/lib/hooks';

/**
 * Histórico do atendimento.
 *
 * A conversa guarda só a situação atual. Aqui está a sequência: quem assumiu, para quem foi
 * transferida, quando encerrou e com que resultado, quantas vezes reabriu.
 *
 * Cada encerramento é um atendimento. Por isso a contagem no topo mostra **atendimentos**, e
 * não "mudanças de status" — é a pergunta que se faz na auditoria.
 */
export function HistorySheet({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const events = useConversationEvents(conversationId);
  const lista = events.data ?? [];
  const encerramentos = lista.filter((e) => e.type === 'closed').length;
  const reaberturas = lista.filter((e) => e.type === 'reopened').length;

  return (
    <Modal open onClose={onClose} title="Histórico do atendimento">
      {events.isLoading && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 rounded-lg bg-field animate-pulse" />)}</div>}

      {!events.isLoading && lista.length === 0 && (
        <p className="text-sm text-muted">
          Nada registrado ainda. O histórico começa a partir das próximas ações — o que aconteceu antes desta
          funcionalidade existir não foi gravado.
        </p>
      )}

      {lista.length > 0 && (
        <>
          <div className="flex gap-4 pb-3 mb-3 border-b border-line text-[12.5px]">
            <span className="text-muted">Atendimentos encerrados: <b className="text-ink tnum">{encerramentos}</b></span>
            {reaberturas > 0 && <span className="text-muted">Reaberturas: <b className="text-ink tnum">{reaberturas}</b></span>}
          </div>
          <ol className="space-y-2.5">
            {lista.map((e) => <Linha key={e.id} e={e} />)}
          </ol>
        </>
      )}
    </Modal>
  );
}

const META: Record<ConversationEvent['type'], { icon: React.ReactNode; texto: string; cor: string }> = {
  claimed: { icon: <Hand size={14} />, texto: 'assumiu o atendimento', cor: 'text-prog' },
  transferred: { icon: <ArrowRightLeft size={14} />, texto: 'transferiu', cor: 'text-accent' },
  released: { icon: <Undo2 size={14} />, texto: 'devolveu para a fila', cor: 'text-wait' },
  closed: { icon: <CheckCircle2 size={14} />, texto: 'encerrou', cor: 'text-done' },
  reopened: { icon: <RotateCcw size={14} />, texto: 'reabriu', cor: 'text-wait' },
};

const RESULTADO: Record<string, string> = { won: 'comprou', lost: 'não comprou', none: 'sem resultado' };

function Linha({ e }: { e: ConversationEvent }) {
  const m = META[e.type];
  // ator nulo = foi a automação. Dizer "sistema" é melhor que deixar em branco: em auditoria,
  // campo vazio é interpretado como falha de registro
  const quem = e.actor?.name ?? 'Automação';
  const valor = e.outcomeValue ? Number(e.outcomeValue) : null;

  return (
    <li className="flex gap-2.5 text-[13px]">
      <span className={`mt-0.5 shrink-0 ${m.cor}`}>{m.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-ink">
          <b>{quem}</b> {m.texto}
          {e.type === 'transferred' && e.target && <> para <b>{e.target.name}</b></>}
          {e.type === 'closed' && e.outcome && <> · {RESULTADO[e.outcome] ?? e.outcome}</>}
          {valor != null && valor > 0 && <> · <span className="tnum">{valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></>}
        </div>
        {e.reason && <div className="text-xs text-muted">{e.reason}</div>}
        <div className="text-[11px] text-faint tnum">{new Date(e.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    </li>
  );
}
