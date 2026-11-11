'use client';
import { useEffect, useState } from 'react';
import { Copy, Sparkles, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { useAiCredits, useAsaasPaymentStatus, useBuyAiCredits, useCancelAiCredits, useHasFeature, useSetAiCreditAuto, type AsaasPayment } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const PACOTES = [20, 50, 100, 200];

/**
 * Saldo de IA pré-pago (docs/15-ia.md#saldo-de-ia): o cliente vê o saldo e quantas respostas,
 * em média, ele rende — nunca a margem. Compra por Pix (Asaas); o saldo entra quando o
 * pagamento cai. Só para quem cuida da cobrança (`billing.manage`) e com IA no plano.
 */
export function AiCreditsSection() {
  const copilot = useHasFeature('ai_copilot');
  const flows = useHasFeature('ai_flows');
  const temIa = copilot.has || flows.has;
  const q = useAiCredits(temIa);
  const auto = useSetAiCreditAuto();
  const [comprando, setComprando] = useState(false);
  if (!temIa || !q.data) return null;
  const c = q.data;
  const pendente = c.purchases.find((p) => p.status === 'pending' && p.externalId);

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-accent-soft text-accent-ink p-2"><Wallet size={18} /></span>
          <div>
            <h2 className="font-display font-semibold text-ink">Saldo de IA</h2>
            <p className="text-xs text-muted mt-0.5">Usado quando a IA passa do que o plano inclui, ou quando o limite grátis da sua chave própria acaba no dia.</p>
          </div>
        </div>
        <Button icon={<Sparkles size={14} />} onClick={() => setComprando(true)}>Comprar saldo</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-field px-4 py-3">
          <div className="text-[11px] text-muted">Saldo</div>
          <div className={cn('text-xl font-semibold', c.balanceBrl <= 0 ? 'text-danger' : 'text-ink')}>{brl(c.balanceBrl)}</div>
          <div className="text-xs text-muted">≈ {c.estimatedInteractions.toLocaleString('pt-BR')} respostas da IA</div>
        </div>
        <div className="rounded-xl bg-field px-4 py-3">
          <div className="text-[11px] text-muted">Usado este mês</div>
          <div className="text-xl font-semibold text-ink">{brl(c.month.spentBrl)}</div>
          <div className="text-xs text-muted">{c.month.interactions.toLocaleString('pt-BR')} respostas</div>
        </div>
        <div className="rounded-xl bg-field px-4 py-3">
          <div className="text-[11px] text-muted">Média por resposta</div>
          <div className="text-xl font-semibold text-ink">{brl(c.avgPriceBrl)}</div>
          <div className="text-xs text-muted">varia com o tamanho da conversa</div>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={c.autoUseOnFreeLimit} disabled={auto.isPending} onChange={(e) => auto.mutate(e.target.checked)} />
        <span>Quando o limite grátis da minha chave própria acabar no dia, <b>continuar respondendo com o saldo</b>. <span className="text-muted">Desligado: a conversa vai para a equipe até o limite voltar.</span></span>
      </label>

      {c.purchases.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted uppercase tracking-wide">Compras</div>
          <ul className="divide-y divide-line text-sm">
            {c.purchases.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>{new Date(p.createdAt).toLocaleDateString('pt-BR')} · {brl(p.amountBrl)}{p.note ? <span className="text-muted"> · {p.note}</span> : null}</span>
                <span className={cn('text-xs', p.status === 'paid' ? 'text-ok' : p.status === 'pending' ? 'text-warn' : 'text-muted')}>
                  {p.status === 'paid' ? (p.paidVia === 'manual' ? 'creditado' : 'pago') : p.status === 'pending' ? 'aguardando Pix' : 'cancelado'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {comprando && <BuyModal hasDocument={c.hasDocument} min={c.limits.min} max={c.limits.max} avg={c.avgPriceBrl} pendingId={pendente?.id ?? null} onClose={() => setComprando(false)} />}
    </section>
  );
}

function BuyModal({ hasDocument, min, max, avg, pendingId, onClose }: { hasDocument: boolean; min: number; max: number; avg: number; pendingId: string | null; onClose: () => void }) {
  const buy = useBuyAiCredits();
  const cancel = useCancelAiCredits();
  const credits = useAiCredits();
  const [valor, setValor] = useState('50');
  const [doc, setDoc] = useState('');
  const [pix, setPix] = useState<{ purchaseId: string; payment: AsaasPayment } | null>(null);
  const status = useAsaasPaymentStatus(pix?.payment.id ?? null, !!pix && !pix.payment.paid);
  const pago = !!status.data?.paid;
  const v = Number(valor.replace(',', '.'));
  const valido = Number.isFinite(v) && v >= min && v <= max;

  useEffect(() => {
    if (!pago) return;
    toast.ok('Pagamento confirmado: saldo de IA liberado');
    void credits.refetch();
    onClose();
  }, [pago]); // eslint-disable-line react-hooks/exhaustive-deps

  async function gerar() {
    try {
      setPix(await buy.mutateAsync({ amountBrl: v, ...(!hasDocument && { document: doc }) }));
    } catch (e) { toast.err(e); }
  }
  async function fechar() {
    // fechou sem pagar: cancela o Pix para não ficar cobrança perdida no Asaas
    if (pix && !pago) await cancel.mutateAsync(pix.purchaseId).catch(() => undefined);
    onClose();
  }
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast.ok('Código Pix copiado'), () => toast.err('Não foi possível copiar'));

  return (
    <Modal open onClose={() => void fechar()} title="Comprar saldo de IA">
      {!pix ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PACOTES.map((p) => (
              <button key={p} type="button" onClick={() => setValor(String(p))} className={cn('rounded-lg border px-3 py-1.5 text-sm', v === p ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-ink hover:bg-field')}>{brl(p)}</button>
            ))}
          </div>
          <Field label={`Valor (de ${brl(min)} a ${brl(max)})`}>
            <input className={inputCls} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          </Field>
          {valido && avg > 0 && <p className="text-sm text-muted">Rende em média <b className="text-ink">≈ {Math.floor(v / avg).toLocaleString('pt-BR')} respostas</b> da IA.</p>}
          {!hasDocument && (
            <Field label="CPF ou CNPJ da empresa (o Asaas exige para o Pix)">
              <input className={inputCls} inputMode="numeric" value={doc} onChange={(e) => setDoc(e.target.value)} />
            </Field>
          )}
          {pendingId && <p className="text-xs text-muted">Há um Pix anterior em aberto: ele é cancelado ao gerar este.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button disabled={!valido || (!hasDocument && doc.replace(/\D/g, '').length < 11)} loading={buy.isPending} onClick={() => void gerar()}>Gerar Pix</Button>
          </div>
        </div>
      ) : pix.payment.pix ? (
        <div className="space-y-4 text-center">
          <img src={`data:image/png;base64,${pix.payment.pix.encodedImage}`} alt="QR code Pix" className="mx-auto w-56 h-56 rounded-lg border border-line bg-white p-1" />
          <div className="flex gap-2">
            <input readOnly value={pix.payment.pix.payload} className={cn(inputCls, 'font-mono text-xs')} onFocus={(e) => e.target.select()} />
            <Button type="button" size="sm" icon={<Copy size={13} />} onClick={() => void copy(pix.payment.pix!.payload)}>Copiar</Button>
          </div>
          <p className="text-xs text-faint flex items-center justify-center gap-2">
            <span className="w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            Aguardando pagamento: o saldo entra sozinho assim que o Pix cair.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted text-center py-4">
          Cobrança gerada. {pix.payment.invoiceUrl && <a href={pix.payment.invoiceUrl} target="_blank" rel="noreferrer" className="text-accent underline">Abrir cobrança</a>}
        </p>
      )}
    </Modal>
  );
}
