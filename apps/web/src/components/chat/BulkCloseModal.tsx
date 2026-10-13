'use client';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useBulkClose } from '@/lib/hooks';
import { CloseTagsField, OUTCOMES, Secao } from './CloseModal';

/**
 * Encerrar vários atendimentos selecionados.
 *
 * Difere do encerramento de um só em duas coisas, e as duas são de propósito:
 *  - **só "Não comprou"**: venda exige valor, e o valor é por conversa — repetir o mesmo
 *    número em trinta atendimentos inflaria o faturamento do relatório (a API recusa). Como o
 *    resultado é obrigatório, sobra "Não comprou", que é o caso da fila de quem não respondeu;
 *  - **não dispara fluxo**: fluxo de encerramento em trinta contatos é envio em massa, que
 *    tem tela própria, com limite diário e opt-out.
 */
export function BulkCloseModal({ ids, onDone, onClose }: { ids: string[]; onDone: () => void; onClose: () => void }) {
  const bulk = useBulkClose();
  const [tagIds, setTagIds] = useState<string[]>([]);
  const naoComprou = OUTCOMES.find((o) => o.id === 'lost')!;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await bulk.mutateAsync({ ids, outcome: 'lost', tagIds: tagIds.length ? tagIds : undefined });
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
        <Secao titulo="Resultado" dica="Vale para todos os selecionados. Venda (“Comprou”) é encerrada uma a uma, com o valor de cada atendimento.">
          <div className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium ${naoComprou.cls}`}>
            {naoComprou.icon} {naoComprou.label}
          </div>
        </Secao>

        <div className="border-t border-line pt-4">
          <CloseTagsField value={tagIds} onChange={setTagIds} dica="Aplicadas a todos. O mais comum aqui é “Não respondeu”, que é justamente o que entope a fila." />
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="success" loading={bulk.isPending} loadingText="Encerrando…">Encerrar {ids.length}</Button>
        </div>
      </form>
    </Modal>
  );
}
