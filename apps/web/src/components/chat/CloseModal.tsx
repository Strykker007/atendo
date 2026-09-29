'use client';
import { useState } from 'react';
import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useFlows, useHasFeature, useSetStatus, type ConversationOutcome } from '@/lib/hooks';

const MOTIVOS = ['Preço', 'Prazo', 'Não respondeu', 'Comprou com concorrente', 'Fora da área', 'Só pesquisando'];

/**
 * Encerramento com resultado. É o que transforma o relatório de conversas em relatório de
 * vendas — e o motivo da perda é o que mostra onde o negócio escapa.
 */
export function CloseModal({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const setStatus = useSetStatus();
  const flowsFeature = useHasFeature('flows');
  const flows = useFlows();
  const [outcome, setOutcome] = useState<ConversationOutcome>('none');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [flowId, setFlowId] = useState('');

  const opcoes: { id: ConversationOutcome; label: string; icon: React.ReactNode; cls: string }[] = [
    { id: 'won', label: 'Comprou', icon: <CheckCircle2 size={15} />, cls: 'border-ok text-ok bg-ok-soft' },
    { id: 'lost', label: 'Não comprou', icon: <XCircle size={15} />, cls: 'border-danger text-danger bg-danger-soft' },
    { id: 'none', label: 'Sem resultado', icon: <MinusCircle size={15} />, cls: 'border-line text-muted bg-field' },
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = outcome === 'won' && valor ? Number(valor.replace(',', '.')) : undefined;
    if (outcome === 'won' && valor && !Number.isFinite(value)) return toast.err(new Error('Valor inválido'));
    try {
      await setStatus.mutateAsync({
        id: conversationId,
        status: 'closed',
        outcome,
        value,
        reason: outcome === 'lost' ? motivo || undefined : undefined,
        flowId: flowId || undefined,
      });
      toast.ok('Atendimento encerrado');
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title="Encerrar atendimento">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Resultado" hint="Alimenta o relatório de vendas. Pode deixar sem resultado.">
          <div className="flex flex-wrap gap-2">
            {opcoes.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setOutcome(o.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium ${outcome === o.id ? o.cls : 'border-line text-muted hover:bg-field'}`}
              >
                {o.icon} {o.label}
              </button>
            ))}
          </div>
        </Field>

        {outcome === 'won' && (
          <Field label="Valor da venda (R$)" hint="Opcional, mas é o que permite somar faturamento por atendente, origem e campanha.">
            <input className={inputCls} inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus />
          </Field>
        )}

        {outcome === 'lost' && (
          <Field label="Motivo" hint="É o que mostra onde você está perdendo negócio.">
            <input className={inputCls} list="motivos-perda" placeholder="Preço, prazo, não respondeu…" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
            <datalist id="motivos-perda">{MOTIVOS.map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
        )}

        {flowsFeature.has && (
          <Field label="Disparar fluxo ao encerrar (opcional)" hint="Pesquisa de satisfação, pós-venda, recuperação.">
            <select className={inputCls} value={flowId} onChange={(e) => setFlowId(e.target.value)}>
              <option value="">Nenhum</option>
              {(flows.data ?? []).filter((f) => f.isActive).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={setStatus.isPending} loadingText="Encerrando…">Encerrar</Button>
        </div>
      </form>
    </Modal>
  );
}
