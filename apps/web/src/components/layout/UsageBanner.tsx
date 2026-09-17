'use client';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useUsage } from '@/lib/hooks';

/** Aviso global em 80% / 100% do plano — aparece no topo de todas as telas. */
export function UsageBanner() {
  const { data: u } = useUsage();
  if (!u?.limits) return null;
  const msgs = u.limits.includedMessagesMonth ? u.used.messages / u.limits.includedMessagesMonth : 0;
  const tpl = u.limits.includedTemplatesMonth ? u.used.templates / u.limits.includedTemplatesMonth : 0;
  const ratio = Math.max(msgs, tpl);
  if (ratio < 0.8 && u.status !== 'past_due' && u.status !== 'suspended') return null;

  const blocked = ratio >= 1 && u.limits.hardLimit;
  const text =
    u.status === 'suspended' ? 'Assinatura suspensa — envio bloqueado.'
    : u.status === 'past_due' ? 'Pagamento pendente — regularize para evitar suspensão.'
    : blocked ? `Limite do plano ${u.plan} atingido — envio bloqueado até o próximo mês.`
    : ratio >= 1 ? `Você passou do incluído no plano ${u.plan} — o excedente será cobrado na fatura.`
    : `Você usou ${Math.round(ratio * 100)}% do plano ${u.plan} este mês.`;

  return (
    <div className={`flex items-center gap-2 px-4 py-1.5 text-[13px] ${blocked || u.status === 'suspended' ? 'bg-danger text-white' : 'bg-warn-soft text-warn-ink'}`}>
      <AlertTriangle size={16} className="shrink-0" />
      <span className="flex-1">{text}</span>
      <Link href="/plano" className="underline font-medium whitespace-nowrap">Ver plano</Link>
    </div>
  );
}
