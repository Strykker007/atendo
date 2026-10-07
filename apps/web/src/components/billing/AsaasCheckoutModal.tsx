'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, CreditCard, ExternalLink, QrCode } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useAsaasCheckout, useAsaasCustomer, useAsaasPaymentStatus, useMe, type AsaasPayment, type Plan } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Checkout do Asaas. Dois modos:
 * - `plan`: assinar/trocar de plano — escolhe PIX ou cartão e envia;
 * - `payment`: pagar uma cobrança já gerada (renovação ou atraso) — vai direto ao QR.
 *
 * PIX: mostra QR + copia e cola e consulta a situação a cada 4 s até o pagamento cair.
 * Cartão: os dados vão para a API só para serem tokenizados no Asaas; nada fica salvo aqui.
 */
export function AsaasCheckoutModal({ plan, payment: initial, onClose }: { plan?: Plan | null; payment?: AsaasPayment | null; onClose: () => void }) {
  const open = !!plan || !!initial;
  const qc = useQueryClient();
  const me = useMe();
  const customer = useAsaasCustomer(open);
  const checkout = useAsaasCheckout();
  const [method, setMethod] = useState<'PIX' | 'CREDIT_CARD'>('PIX');
  const [doc, setDoc] = useState('');
  const [card, setCard] = useState({ holderName: '', number: '', expiry: '', ccv: '' });
  const [holder, setHolder] = useState({ email: '', postalCode: '', addressNumber: '', phone: '' });
  const [payment, setPayment] = useState<AsaasPayment | null>(initial ?? null);
  const status = useAsaasPaymentStatus(payment?.id ?? null, open && !!payment && !payment.paid);
  const paid = payment?.paid || status.data?.paid;

  useEffect(() => { setPayment(initial ?? null); }, [initial, plan]);
  // preenche com o que já está no Asaas: renovar não pode exigir redigitar CPF
  useEffect(() => {
    const c = customer.data;
    if (c?.cpfCnpj) setDoc((d) => d || c.cpfCnpj);
    setHolder((h) => ({
      email: h.email || c?.email || me.data?.email || '',
      postalCode: h.postalCode || c?.postalCode || '',
      addressNumber: h.addressNumber || c?.addressNumber || '',
      phone: h.phone || c?.mobilePhone || '',
    }));
  }, [customer.data, me.data?.email]);

  // pagou: atualiza plano, status e faturas e fecha depois de mostrar a confirmação
  useEffect(() => {
    if (!paid) return;
    qc.invalidateQueries({ queryKey: ['usage'] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['asaas-pending'] });
    const t = setTimeout(onClose, 2200);
    return () => clearTimeout(t);
  }, [paid, qc, onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!plan) return;
    const [mm, yy] = card.expiry.split('/').map((s) => s.trim());
    try {
      const r = await checkout.mutateAsync({
        planId: plan.id,
        billingType: method,
        customer: { cpfCnpj: doc, email: holder.email || undefined, mobilePhone: holder.phone || undefined },
        ...(method === 'CREDIT_CARD' && {
          card: { holderName: card.holderName, number: card.number, expiryMonth: mm ?? '', expiryYear: yy?.length === 2 ? `20${yy}` : yy ?? '', ccv: card.ccv },
          holder: { name: card.holderName, email: holder.email, cpfCnpj: doc, postalCode: holder.postalCode, addressNumber: holder.addressNumber, phone: holder.phone },
        }),
      });
      qc.invalidateQueries({ queryKey: ['usage'] });
      if (!r.payment) { toast.ok('Plano alterado.'); onClose(); return; }
      setPayment(r.payment);
    } catch (err) {
      toast.err(err);
    }
  }

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.ok('Código PIX copiado'), () => toast.err('Não foi possível copiar'));
  const valor = plan ? (plan.billingCycle === 'yearly' && plan.priceYear != null ? `${brl(Number(plan.priceYear))}/ano` : `${brl(Number(plan.priceMonth))}/mês`) : payment ? brl(payment.value) : '';

  return (
    <Modal open={open} onClose={onClose} title={plan ? `Assinar ${plan.name} — ${valor}` : `Pagar ${valor}`} width="max-w-md">
      {paid ? (
        <div className="py-8 text-center text-accent">
          <CheckCircle2 size={56} className="mx-auto" />
          <p className="mt-3 font-medium">Pagamento confirmado!</p>
        </div>
      ) : payment ? (
        <PaymentStep payment={status.data ? { ...status.data, pix: payment.pix } : payment} onCopy={copy} />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {([['PIX', 'PIX', <QrCode key="p" size={16} />], ['CREDIT_CARD', 'Cartão de crédito', <CreditCard key="c" size={16} />]] as const).map(([v, label, icon]) => (
              <button key={v} type="button" onClick={() => setMethod(v)} className={cn('flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm', method === v ? 'border-accent ring-1 ring-accent text-accent-ink bg-accent-soft' : 'border-line text-ink hover:bg-field')}>
                {icon}{label}
              </button>
            ))}
          </div>

          <Field label="CPF ou CNPJ de quem paga" hint="Exigido para emitir a cobrança.">
            <input className={inputCls} value={doc} onChange={(e) => setDoc(e.target.value)} inputMode="numeric" required placeholder="000.000.000-00" />
          </Field>

          {method === 'CREDIT_CARD' && (
            <>
              <Field label="Nome impresso no cartão">
                <input className={inputCls} value={card.holderName} onChange={(e) => setCard({ ...card, holderName: e.target.value })} required autoComplete="cc-name" />
              </Field>
              <Field label="Número do cartão">
                <input className={inputCls} value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} required inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Validade">
                  <input className={inputCls} value={card.expiry} onChange={(e) => setCard({ ...card, expiry: e.target.value })} required autoComplete="cc-exp" placeholder="MM/AAAA" />
                </Field>
                <Field label="CVV">
                  <input className={inputCls} value={card.ccv} onChange={(e) => setCard({ ...card, ccv: e.target.value })} required inputMode="numeric" autoComplete="cc-csc" maxLength={4} />
                </Field>
              </div>
              <Field label="E-mail do titular">
                <input className={inputCls} type="email" value={holder.email} onChange={(e) => setHolder({ ...holder, email: e.target.value })} required />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="CEP">
                  <input className={inputCls} value={holder.postalCode} onChange={(e) => setHolder({ ...holder, postalCode: e.target.value })} required inputMode="numeric" autoComplete="postal-code" />
                </Field>
                <Field label="Número">
                  <input className={inputCls} value={holder.addressNumber} onChange={(e) => setHolder({ ...holder, addressNumber: e.target.value })} required />
                </Field>
                <Field label="Telefone">
                  <input className={inputCls} value={holder.phone} onChange={(e) => setHolder({ ...holder, phone: e.target.value })} required inputMode="tel" autoComplete="tel" />
                </Field>
              </div>
              <p className="text-xs text-faint">A cobrança se renova sozinha no cartão a cada ciclo. Os dados do cartão vão direto para o Asaas e não ficam salvos no Atendo.</p>
            </>
          )}
          {method === 'PIX' && <p className="text-xs text-faint">Geramos o QR code agora. A cada renovação, uma nova cobrança PIX fica disponível nesta tela e chega por e-mail.</p>}

          <Button type="submit" className="w-full" loading={checkout.isPending}>{method === 'PIX' ? 'Gerar PIX' : `Pagar ${valor}`}</Button>
        </form>
      )}
    </Modal>
  );
}

function PaymentStep({ payment, onCopy }: { payment: AsaasPayment; onCopy: (t: string) => void }) {
  if (payment.pix) {
    return (
      <div className="text-center space-y-4">
        <img src={`data:image/png;base64,${payment.pix.encodedImage}`} alt="QR code PIX" className="mx-auto w-56 h-56 rounded-lg border border-line bg-white p-1" />
        <div className="space-y-1.5">
          <div className="text-xs text-muted">PIX copia e cola</div>
          <div className="flex gap-2">
            <input readOnly value={payment.pix.payload} className={cn(inputCls, 'font-mono text-xs')} onFocus={(e) => e.target.select()} />
            <Button type="button" size="sm" icon={<Copy size={13} />} onClick={() => onCopy(payment.pix!.payload)}>Copiar</Button>
          </div>
        </div>
        <p className="text-xs text-faint flex items-center justify-center gap-2">
          <span className="w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          Aguardando pagamento — esta tela atualiza sozinha.
        </p>
      </div>
    );
  }
  // cartão em análise/recusado, ou cobrança sem PIX: o link do Asaas resolve
  return (
    <div className="space-y-3 text-sm text-center py-4">
      <p className="text-muted">{payment.billingType === 'CREDIT_CARD' ? 'Cobrança no cartão em processamento. Se não for aprovada, pague pelo link abaixo.' : 'Cobrança gerada.'}</p>
      {payment.invoiceUrl && (
        <a href={payment.invoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-accent-ink underline">
          Abrir cobrança <ExternalLink size={13} />
        </a>
      )}
    </div>
  );
}
