'use client';
import { CreditCard, MessageSquare, FileText, Smartphone, Users, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Skeleton, SkeletonCards } from '@/components/ui/Skeleton';
import { useUsage } from '@/lib/hooks';

const STATUS: Record<string, { label: string; cls: string }> = {
  trialing: { label: 'Período de teste', cls: 'bg-sky-50 text-sky-700' },
  active: { label: 'Ativa', cls: 'bg-brand-soft text-brand' },
  past_due: { label: 'Pagamento pendente', cls: 'bg-amber-50 text-amber-700' },
  suspended: { label: 'Suspensa', cls: 'bg-red-50 text-red-700' },
  canceled: { label: 'Cancelada', cls: 'bg-gray-100 text-gray-600' },
};
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PlanoPage() {
  const { data: u } = useUsage();
  if (!u) return (
    <PageShell width="max-w-4xl">
      <PageHeader title="Plano e uso" subtitle="Carregando consumo…" />
      <div className="rounded-2xl bg-white border border-surface-border p-5 flex gap-6"><Skeleton className="w-12 h-12 rounded-xl" /><Skeleton className="h-10 flex-1" /></div>
      <SkeletonCards count={4} />
    </PageShell>
  );
  if (!u.limits) return <PageShell><PageHeader title="Plano e uso" /><p className="text-sm text-gray-500">Este cliente não tem assinatura. Fale com o suporte.</p></PageShell>;

  const L = u.limits;
  const st = STATUS[u.status ?? ''] ?? STATUS.active;
  const [y, m] = u.period.split('-');
  const periodLabel = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <PageShell width="max-w-4xl">
      <PageHeader title="Plano e uso" subtitle={`Consumo de ${periodLabel}. Os contadores zeram no início de cada mês.`} />

      {/* Cartão do plano */}
      <div className="rounded-2xl bg-white border border-surface-border p-5 flex flex-wrap items-center gap-6">
        <div className="w-12 h-12 rounded-xl bg-brand-soft text-brand grid place-items-center"><CreditCard size={22} /></div>
        <div className="flex-1 min-w-40">
          <div className="text-xs text-gray-500">Plano atual</div>
          <div className="text-lg font-semibold">{u.plan}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Mensalidade</div>
          <div className="font-medium">{u.priceMonth != null ? brl(u.priceMonth) : '—'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Excedente até agora</div>
          <div className={cn('font-medium', u.overageAmount > 0 && 'text-amber-700')}>{brl(u.overageAmount)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Renova em</div>
          <div className="font-medium">{u.currentPeriodEnd ? new Date(u.currentPeriodEnd).toLocaleDateString('pt-BR') : '—'}</div>
        </div>
        <span className={cn('text-xs rounded-full px-2.5 py-1', st.cls)}>{st.label}</span>
      </div>

      {(u.status === 'past_due' || u.status === 'suspended') && (
        <div className="flex gap-2 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-800">
          <AlertTriangle size={18} className="shrink-0" />
          <span>{u.status === 'suspended' ? 'Assinatura suspensa: os números continuam recebendo mensagens, mas não é possível responder até regularizar o pagamento.' : 'Há um pagamento pendente. Regularize para evitar a suspensão.'}</span>
        </div>
      )}

      {/* Medidores */}
      <div className="grid gap-4 md:grid-cols-2">
        <Meter icon={<MessageSquare size={18} />} label="Mensagens enviadas" used={u.used.messages} max={L.includedMessagesMonth} hard={L.hardLimit} overage={L.overagePricePerMessage} hint={`${u.used.messagesIn.toLocaleString('pt-BR')} recebidas (não contam no limite)`} />
        <Meter icon={<FileText size={18} />} label="Templates (Meta)" used={u.used.templates} max={L.includedTemplatesMonth} hard={L.hardLimit} overage={L.overagePricePerTemplate} hint="Só mensagens ativas pela API oficial custam template" />
        <Meter icon={<Smartphone size={18} />} label="Números" used={u.used.numbers} max={L.maxNumbers} hard />
        <Meter icon={<Users size={18} />} label="Atendentes" used={u.used.agents} max={L.maxAgents} hard />
      </div>

      <div className="rounded-2xl bg-white border border-surface-border p-5 text-sm text-gray-600 space-y-1">
        <p className="font-medium text-gray-800">Como funciona o limite</p>
        {L.hardLimit ? (
          <p>Seu plano é <b>fixo</b>: ao atingir o limite de mensagens ou templates, o envio é bloqueado até o próximo mês ou até fazer upgrade. Você recebe aviso em 80% e 100%.</p>
        ) : (
          <p>Seu plano permite <b>excedente</b>: acima do incluído, cada mensagem custa {L.overagePricePerMessage != null ? brl(L.overagePricePerMessage) : '—'} e cada template {L.overagePricePerTemplate != null ? brl(L.overagePricePerTemplate) : '—'}, cobrados na próxima fatura. Você recebe aviso em 80% e 100%.</p>
        )}
        <p className="text-gray-400 text-xs pt-1">Para mudar de plano, fale com o suporte. (Autoatendimento de upgrade em breve.)</p>
      </div>
    </PageShell>
  );
}

function Meter({ icon, label, used, max, hard, overage, hint }: { icon: React.ReactNode; label: string; used: number; max: number; hard: boolean; overage?: number | null; hint?: string }) {
  const ratio = max ? used / max : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const tone = ratio >= 1 ? 'bg-red-500' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-brand';
  return (
    <div className="rounded-2xl bg-white border border-surface-border p-5 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium"><span className="text-gray-400">{icon}</span>{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold">{used.toLocaleString('pt-BR')}</span>
        <span className="text-sm text-gray-400">/ {max.toLocaleString('pt-BR')}</span>
        <span className={cn('ml-auto text-xs font-medium', ratio >= 1 ? 'text-red-600' : ratio >= 0.8 ? 'text-amber-600' : 'text-gray-400')}>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-surface-muted overflow-hidden"><div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} /></div>
      <p className="text-xs text-gray-400">
        {ratio >= 1 ? (hard || overage == null ? 'Limite atingido — bloqueado.' : 'Acima do incluído — cobrando excedente.') : hint ?? ''}
      </p>
    </div>
  );
}
