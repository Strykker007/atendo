'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, QrCode } from 'lucide-react';
import { isValidCpfCnpj } from '@atendo/shared';
import { useSetBillingDocument, useUsage, type Usage } from '@/lib/hooks';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

const NOME = { messages: 'mensagens', conversations: 'conversas', templates: 'templates' } as const;

/**
 * Aviso global em 80% / 100% do plano — aparece no topo de todas as telas. O percentual vem
 * pronto da API (`quota`), pela unidade do plano: recalcular aqui já mostrou "92%" para um
 * plano por conversa ilimitado.
 */
export function UsageBanner() {
  const { data: u } = useUsage();
  if (!u) return null;
  return (
    <>
      <MensalidadeBanner notice={u.billingNotice ?? null} atrasada={u.status === 'past_due' || u.status === 'suspended'} />
      {/* o aviso da ativação já diz que o envio está bloqueado */}
      {u.billingNotice?.kind !== 'activation_due' && <UsoBanner u={u} />}
    </>
  );
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('pt-BR');
const mascara = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d.length <= 11
    ? d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    : d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
};

/**
 * Mensalidade por Pix (docs/05#lembretes-da-mensalidade), só para quem paga: pede o CPF/CNPJ
 * que falta para entrar na cobrança automática, ou avisa que vence nos próximos dias. Atrasada
 * fica com o aviso de pagamento pendente (abaixo), que já leva ao "Pagar agora".
 */
function MensalidadeBanner({ notice, atrasada }: { notice: Usage['billingNotice'] | null; atrasada: boolean }) {
  const [aberto, setAberto] = useState(false);
  if (!notice || (notice.kind === 'payment_due' && atrasada)) return null;
  if (notice.kind === 'activation_due') {
    return (
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-[13px] bg-accent text-white">
        <QrCode size={16} className="shrink-0" />
        <span className="flex-1 min-w-[200px]">
          <b>Ative sua conta:</b> pague {brl(notice.value)} ({notice.items.map((i) => i.description).join(' + ')}) por Pix. Você já pode configurar tudo; o envio de mensagens é liberado assim que o pagamento cair.
        </span>
        <Link href="/plano?pagar=1" className="rounded-lg bg-white/15 hover:bg-white/25 px-2.5 py-1 font-medium whitespace-nowrap">Pagar com Pix</Link>
      </div>
    );
  }
  if (notice.kind === 'needs_document') {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 text-[13px] bg-accent-soft text-accent-ink">
          <QrCode size={16} className="shrink-0" />
          <span className="flex-1 min-w-[200px]">Ative o pagamento automático da mensalidade por Pix: falta só o CPF ou CNPJ da empresa.</span>
          <button type="button" onClick={() => setAberto(true)} className="underline font-medium whitespace-nowrap">Informar agora</button>
        </div>
        {aberto && <DocumentoModal onClose={() => setAberto(false)} />}
      </>
    );
  }
  const quando = notice.daysLeft <= 0 ? 'vence hoje' : notice.daysLeft === 1 ? 'vence amanhã' : `vence em ${dataBR(notice.dueDate)}`;
  return (
    <div className={`flex flex-wrap items-center gap-2 px-4 py-1.5 text-[13px] ${notice.daysLeft <= 0 ? 'bg-warn-soft text-warn-ink' : 'bg-accent-soft text-accent-ink'}`}>
      <QrCode size={16} className="shrink-0" />
      <span className="flex-1 min-w-[200px]">Sua mensalidade de <b>{brl(notice.value)}</b> {quando}. Pague por Pix pelo painel — a baixa é automática.</span>
      <Link href="/plano?pagar=1" className="underline font-medium whitespace-nowrap">Pagar com Pix</Link>
    </div>
  );
}

function DocumentoModal({ onClose }: { onClose: () => void }) {
  const [doc, setDoc] = useState('');
  const salvar = useSetBillingDocument();
  const valido = isValidCpfCnpj(doc);
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await salvar.mutateAsync(doc);
      toast.ok(r.enrolled ? 'Pagamento automático ativado. Você recebe o Pix por e-mail antes de cada vencimento.' : 'CPF/CNPJ salvo.');
      onClose();
    } catch (err) { toast.err(err); }
  }
  return (
    <Modal open onClose={onClose} title="Pagamento automático por Pix" width="max-w-md">
      <form onSubmit={enviar} className="space-y-4">
        <p className="text-sm text-muted">A mensalidade passa a ser cobrada por Pix: antes de cada vencimento você recebe por e-mail (e vê aqui no painel) o valor, o QR Code e o código para copiar. O valor e a data de vencimento continuam os mesmos.</p>
        <Field label="CPF ou CNPJ da empresa" hint={doc && !valido ? 'Confira os números: CPF tem 11 dígitos e CNPJ, 14.' : undefined}>
          <input className={inputCls} value={doc} onChange={(e) => setDoc(mascara(e.target.value))} inputMode="numeric" placeholder="00.000.000/0000-00" autoFocus required />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Depois</Button>
          <Button type="submit" disabled={!valido} loading={salvar.isPending} loadingText="Ativando…">Ativar</Button>
        </div>
      </form>
    </Modal>
  );
}

function UsoBanner({ u }: { u: Usage }) {
  const q = u.quota;
  if (!q) return null;
  const ratio = q.ratio ?? 0;
  const blocked = q.blocked || q.templatesBlocked;
  if (ratio < 0.8 && !blocked && u.status !== 'past_due' && u.status !== 'suspended') return null;

  const what = q.metric ? NOME[q.metric] : NOME[q.unit];
  const text =
    q.blocked && q.reason?.startsWith('Conta aguardando ativação') ? 'Conta aguardando ativação — o envio de mensagens é liberado quando o administrador pagar a ativação.'
    : u.status === 'suspended' ? 'Assinatura suspensa — envio bloqueado.'
    : u.status === 'canceled' ? 'Assinatura cancelada — envio bloqueado.'
    : u.status === 'past_due' ? 'Pagamento pendente — regularize para evitar suspensão.'
    : q.blocked ? `Limite de ${NOME[q.unit]} do plano ${u.plan} atingido — envio bloqueado até o próximo mês.`
    : q.templatesBlocked ? `Limite de templates do plano ${u.plan} atingido — mensagens ativas bloqueadas até o próximo mês.`
    : ratio >= 1 ? `Você passou do incluído de ${what} no plano ${u.plan} — o excedente será cobrado na fatura.`
    : `Você usou ${Math.round(ratio * 100)}% das ${what} do plano ${u.plan} este mês.`;

  return (
    <div className={`flex items-center gap-2 px-4 py-1.5 text-[13px] ${q.blocked ? 'bg-danger text-white' : 'bg-warn-soft text-warn-ink'}`}>
      <AlertTriangle size={16} className="shrink-0" />
      <span className="flex-1">{text}</span>
      <Link href="/plano" className="underline font-medium whitespace-nowrap">{u.status === 'past_due' || u.status === 'suspended' ? 'Pagar agora' : 'Ver plano'}</Link>
    </div>
  );
}
