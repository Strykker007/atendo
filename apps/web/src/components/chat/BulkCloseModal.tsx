'use client';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useBulkClose, useCloseReasons, useTags, reasonsFor, useOutcomeLabels } from '@/lib/hooks';
import { CloseReasonField, CloseTagsField, InternalCloseToggle, OUTCOMES, Secao } from './CloseModal';

/**
 * Encerrar vários atendimentos selecionados.
 *
 * Difere do encerramento de um só em duas coisas, e as duas são de propósito:
 *  - **só "Não comprou"**: venda exige valor, e o valor é por conversa — repetir o mesmo
 *    número em trinta atendimentos inflaria o faturamento do relatório (a API recusa). Como o
 *    resultado é obrigatório, sobra "Não comprou", que é o caso da fila de quem não respondeu;
 *  - **não dispara fluxo**: fluxo de encerramento em trinta contatos é envio em massa, que
 *    tem tela própria, com limite diário e opt-out.
 *
 * Com `conversations.close_internal` dá para encerrar todos como atendimento interno (fora dos
 * relatórios, na auditoria) — o caso de uma leva de testes ou de mensagens erradas.
 */
export function BulkCloseModal({ ids, onDone, onClose }: { ids: string[]; onDone: () => void; onClose: () => void }) {
  const bulk = useBulkClose();
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [closeReasonId, setCloseReasonId] = useState<string | null>(null);
  const [tentou, setTentou] = useState(false);
  const [interno, setInterno] = useState(false);
  const reasons = useCloseReasons();
  const tags = useTags();
  const faltaMotivo = reasonsFor(reasons.data, interno ? 'internal' : 'lost').length > 0 && !closeReasonId;
  const naoComprou = OUTCOMES.find((o) => o.id === 'lost')!;
  const labels = useOutcomeLabels();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (faltaMotivo) { setTentou(true); return; }
      const r = await bulk.mutateAsync(interno
        ? { ids, outcome: 'none', internal: true, closeReasonId: closeReasonId ?? undefined }
        : { ids, outcome: 'lost', tagIds: tagIds.length ? tagIds : undefined, closeReasonId: closeReasonId ?? undefined });
      // "ignorados" acontece de verdade: alguém da equipe pode ter encerrado no meio do caminho,
      // ou a conversa saiu do que este usuário opera. Dizer o número evita achar que falhou.
      toast.ok(r.ignored > 0 ? `${r.closed} encerrados · ${r.ignored} já estavam fechados ou fora do seu acesso` : `${r.closed} atendimento(s) encerrados`);
      // pagamento confirmado no atendimento: em massa não absorve o valor — encerrar uma a uma
      if (r.withPayment) toast.warn(`${r.withPayment} atendimento(s) com pagamento confirmado ficaram abertos: encerre um a um, como venda.`);
      onDone();
      onClose();
    } catch (err) {
      toast.err(err);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Encerrar ${ids.length} atendimento(s)`}>
      <form onSubmit={submit} className="space-y-4">
        <InternalCloseToggle value={interno} onChange={(v) => { setInterno(v); setCloseReasonId(null); setTentou(false); }} />
        {interno ? (
          <CloseReasonField outcome="internal" value={closeReasonId} onChange={setCloseReasonId} erro={tentou && faltaMotivo} />
        ) : <>
        <Secao titulo="Resultado" dica={`Vale para todos os selecionados. Venda (“${labels.won}”) é encerrada uma a uma, com o valor de cada atendimento.`}>
          <div className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium ${naoComprou.cls}`}>
            {naoComprou.icon} {labels.lost}
          </div>
        </Secao>

        <div className="border-t border-line pt-4">
          <CloseReasonField outcome="lost" value={closeReasonId} onChange={setCloseReasonId} erro={tentou && faltaMotivo} />
        </div>

        {/* tags opcionais: só quando há tag marcada para "Não comprou" (o motivo é o principal) */}
        {(tags.data ?? []).some((t) => t.showOnLost) && (
          <div className="border-t border-line pt-4">
            <Secao titulo="Tags" opcional dica="Aplicadas ao registro de todos.">
              <CloseTagsField outcome="lost" value={tagIds} onChange={setTagIds} />
            </Secao>
          </div>
        )}
        </>}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="success" loading={bulk.isPending} loadingText="Encerrando…">Encerrar {ids.length}</Button>
        </div>
      </form>
    </Modal>
  );
}
