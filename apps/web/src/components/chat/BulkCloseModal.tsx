'use client';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useBulkClose, type ConversationOutcome } from '@/lib/hooks';
import { LossReasonField, OUTCOMES, Secao } from './CloseModal';

/**
 * Encerrar vários atendimentos selecionados.
 *
 * Difere do encerramento de um só em duas coisas, e as duas são de propósito:
 *  - **não pede valor de venda**: valor é por conversa, e repetir o mesmo número em trinta
 *    atendimentos inflaria o faturamento do relatório;
 *  - **não dispara fluxo**: fluxo de encerramento em trinta contatos é envio em massa, que
 *    tem tela própria, com limite diário e opt-out.
 */
export function BulkCloseModal({ ids, onDone, onClose }: { ids: string[]; onDone: () => void; onClose: () => void }) {
  const bulk = useBulkClose();
  const [outcome, setOutcome] = useState<ConversationOutcome>('none');
  const [motivo, setMotivo] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await bulk.mutateAsync({ ids, outcome, reason: outcome === 'lost' ? motivo || undefined : undefined });
      // "ignorados" acontece de verdade: alguém da equipe pode ter encerrado no meio do caminho,
      // ou a conversa saiu do que este usuário opera. Dizer o número evita achar que falhou.
      toast.ok(r.ignored > 0 ? `${r.closed} encerrados · ${r.ignored} já estavam fechados ou fora do seu acesso` : `${r.closed} atendimento(s) encerrados`);
      onDone();
      onClose();
    } catch (err) {
      toast.err(err);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Encerrar ${ids.length} atendimento(s)`}>
      <form onSubmit={submit} className="space-y-4">
        <Secao titulo="Resultado" dica="Vale para todos os selecionados. O valor da venda não entra aqui — esse é por atendimento.">
          <div className="grid grid-cols-3 gap-2">
            {OUTCOMES.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={outcome === o.id}
                onClick={() => setOutcome(o.id)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium ${outcome === o.id ? o.cls : 'border-line text-muted hover:bg-field'}`}
              >
                {o.icon} {o.label}
              </button>
            ))}
          </div>
        </Secao>

        {outcome === 'lost' && (
          <div className="border-t border-line pt-4">
            <LossReasonField value={motivo} onChange={setMotivo} hint="O mais comum aqui é “não respondeu”, que é justamente o que entope a fila." placeholder="Outro motivo…" />
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={bulk.isPending} loadingText="Encerrando…">Encerrar {ids.length}</Button>
        </div>
      </form>
    </Modal>
  );
}
