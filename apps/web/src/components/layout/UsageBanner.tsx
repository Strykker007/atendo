'use client';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useUsage } from '@/lib/hooks';

const NOME = { messages: 'mensagens', conversations: 'conversas', templates: 'templates' } as const;

/**
 * Aviso global em 80% / 100% do plano — aparece no topo de todas as telas. O percentual vem
 * pronto da API (`quota`), pela unidade do plano: recalcular aqui já mostrou "92%" para um
 * plano por conversa ilimitado.
 */
export function UsageBanner() {
  const { data: u } = useUsage();
  const q = u?.quota;
  if (!u || !q) return null;
  const ratio = q.ratio ?? 0;
  const blocked = q.blocked || q.templatesBlocked;
  if (ratio < 0.8 && !blocked && u.status !== 'past_due' && u.status !== 'suspended') return null;

  const what = q.metric ? NOME[q.metric] : NOME[q.unit];
  const text =
    u.status === 'suspended' ? 'Assinatura suspensa — envio bloqueado.'
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
