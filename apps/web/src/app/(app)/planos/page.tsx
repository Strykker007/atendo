'use client';
import { useState } from 'react';
import { Plus, Package, Pencil, Power, Trash2, Users, Gift } from 'lucide-react';
import { BILLING_CYCLE_LABEL, PLAN_FEATURES, PLAN_FEATURE_LABEL, type BillingCycle, type CountLimit, type PlanFeature, type PlanLimits } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { useAllPlans, useCreatePlan, useUpdatePlan, useDeletePlan, useMe, type PlanInput, type PlanRow } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const centavos = (v: number) => Math.round(v * 100) / 100;
/** Limite de quantidade para leitura: `null`/ausente = ilimitado. */
const qtd = (n: number | null | undefined, um: string, varios: string) => (n == null ? `${varios} ilimitados` : `${n} ${n === 1 ? um : varios}`);

/** Modalidades pagas (gratuito é o interruptor à parte). */
const CICLOS: { id: Exclude<BillingCycle, 'free'>; desc: string }[] = [
  { id: 'monthly', desc: 'Cobrança mensal no cartão (Stripe).' },
  { id: 'yearly', desc: 'Um pagamento por ano (Stripe).' },
  { id: 'custom', desc: 'Valor negociado, cobrado por fora. Você atribui em Clientes.' },
];

/** Linha da lista → formulário de edição (o mesmo objeto serve para ativar/desativar). */
const toForm = (p: PlanRow): PlanInput & { id: string } => ({
  id: p.id, name: p.name, priceMonth: p.priceMonth, priceYear: p.priceYear, isFree: p.isFree, billingCycle: p.billingCycle, durationDays: p.durationDays,
  costMonth: p.costMonth, billingModel: p.billingModel, limits: p.limits, isActive: p.isActive,
});

const MODELOS: { id: PlanInput['billingModel']; label: string; desc: string }[] = [
  { id: 'fixed', label: 'Fixo', desc: 'Mensalidade só. Estourou o limite, bloqueia.' },
  { id: 'hybrid', label: 'Híbrido', desc: 'Mensalidade + excedente por uso acima do incluído.' },
  { id: 'usage', label: 'Por uso', desc: 'Cobrança acompanha o consumo.' },
];

/** Plano novo começa parecido com o Starter: é mais fácil baixar números do que inventá-los. */
const PADRAO: PlanInput = {
  name: '',
  priceMonth: 97,
  priceYear: null,
  isFree: false,
  billingCycle: 'monthly',
  durationDays: null,
  costMonth: 0,
  billingModel: 'fixed',
  limits: {
    maxNumbers: 1,
    maxAgents: 2,
    maxFlows: null,
    maxQuickReplies: null,
    billingUnit: 'conversations',
    includedConversationsMonth: 500,
    overagePricePerConversation: null,
    includedMessagesMonth: 2000,
    includedTemplatesMonth: 100,
    overagePricePerMessage: null,
    overagePricePerTemplate: null,
    hardLimit: true,
    graceDays: 5,
    features: [],
  },
};

/**
 * Catálogo de planos do dono do sistema.
 *
 * Antes os planos só existiam no seed: criar um pacote para um cliente exigia mexer no código
 * e rodar migração — na prática, nenhum plano novo nascia. A funcionalidade de transmissão em
 * massa, por exemplo, está pronta e trancada porque nenhum plano a libera.
 */
export default function PlanosPage() {
  const me = useMe();
  const plans = useAllPlans();
  const criar = useCreatePlan();
  const atualizar = useUpdatePlan();
  const apagar = useDeletePlan();
  const [form, setForm] = useState<(PlanInput & { id?: string }) | null>(null);
  const [confirmar, setConfirmar] = useState<PlanRow | null>(null);

  if (me.data && me.data.role !== 'super_admin') {
    return <PageShell><p className="text-sm text-muted">Área restrita ao dono do sistema.</p></PageShell>;
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    try {
      const salvo = form.id ? await atualizar.mutateAsync({ ...form, id: form.id }) : await criar.mutateAsync(form);
      // sem price no Stripe o plano existe mas não dá para assinar — dizer isso agora evita
      // descobrir no momento em que o cliente clica em "assinar"
      if (!salvo.stripePriceId && salvo.isActive && (salvo.billingCycle === 'monthly' || salvo.billingCycle === 'yearly')) toast.ok('Plano salvo. Ainda sem preço no Stripe — se a cobrança estiver ligada, veja o log da API.');
      else toast.ok('Plano salvo');
      setForm(null);
    } catch (err) { toast.err(err); }
  }
  async function alternarAtivo(p: PlanRow) {
    try {
      await atualizar.mutateAsync({ ...toForm(p), isActive: !p.isActive });
      toast.ok(p.isActive ? 'Plano desativado — some do checkout, quem já assina continua' : 'Plano ativado');
    } catch (err) { toast.err(err); }
  }

  return (
    <PageShell width="max-w-6xl">
      <PageHeader
        title="Planos"
        subtitle="O que cada pacote libera e cobra. Desativar tira do checkout sem mexer em quem já assina."
        action={<Button icon={<Plus size={16} />} onClick={() => setForm({ ...PADRAO })}>Novo plano</Button>}
      />

      {plans.isLoading && <SkeletonRows rows={3} />}
      {plans.data?.length === 0 && <Empty icon={<Package size={36} />} title="Nenhum plano" text="Crie o primeiro pacote para poder assinar clientes." />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {plans.data?.map((p) => (
          <div key={p.id} className={cn('rounded-2xl bg-panel border border-line p-4 flex flex-col gap-2', !p.isActive && 'opacity-60')}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-display font-semibold text-ink truncate">{p.name}</span>
                  {p.isFree && <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-ok-soft text-ok"><Gift size={10} /> Gratuito</span>}
                </div>
                <div className="text-[11px] text-faint">
                  {p.isFree ? (p.durationDays ? `${p.durationDays} dias grátis` : 'Gratuito permanente') : `${BILLING_CYCLE_LABEL[p.billingCycle]} · ${MODELOS.find((m) => m.id === p.billingModel)?.label}`}
                  {!p.isActive && ' · inativo'}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-display font-semibold text-ink tnum">{p.isFree ? 'R$ 0' : p.billingCycle === 'yearly' && p.priceYear != null ? `${brl(p.priceYear)}/ano` : brl(p.priceMonth)}</div>
                {p.isFree ? (
                  <div className="text-[10px] text-faint">sem cobrança</div>
                ) : p.costMonth > 0 ? (
                  <div className="text-[10px] text-faint" title={`Custo cadastrado: ${brl(p.costMonth)} por cliente/mês`}>
                    margem <span className={cn('tnum font-semibold', p.priceMonth - p.costMonth >= 0 ? 'text-ok' : 'text-danger')}>{brl(p.priceMonth - p.costMonth)}</span>
                  </div>
                ) : (
                  <div className="text-[10px] text-faint">por mês</div>
                )}
              </div>
            </div>

            <ul className="text-[12px] text-muted space-y-0.5">
              <li>{qtd(p.limits.maxNumbers, 'número', 'números')} · {qtd(p.limits.maxAgents, 'usuário', 'usuários')}</li>
              {(p.limits.maxFlows != null || p.limits.maxQuickReplies != null) && (
                <li>{qtd(p.limits.maxFlows, 'fluxo ativo', 'fluxos ativos')} · {qtd(p.limits.maxQuickReplies, 'resposta rápida', 'respostas rápidas')}</li>
              )}
              <li>
                {p.limits.billingUnit === 'conversations'
                  ? p.limits.includedConversationsMonth === null ? 'conversas ilimitadas' : `${(p.limits.includedConversationsMonth ?? 0).toLocaleString('pt-BR')} conversas/mês`
                  : p.limits.includedMessagesMonth === null ? 'mensagens ilimitadas' : `${p.limits.includedMessagesMonth.toLocaleString('pt-BR')} mensagens/mês`}
                {p.limits.hardLimit ? ' · bloqueia ao estourar' : ' · cobra excedente'}
              </li>
              {(p.limits.features?.length ?? 0) > 0 && (
                <li className="flex flex-wrap gap-1 pt-1">
                  {p.limits.features!.map((f) => (
                    <span key={f} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-accent-soft text-accent-ink">{PLAN_FEATURE_LABEL[f]}</span>
                  ))}
                </li>
              )}
            </ul>

            <div className="flex items-center gap-1.5 pt-1 mt-auto border-t border-line">
              <span className="text-[11px] text-faint flex items-center gap-1 flex-1" title="Clientes assinando este plano">
                <Users size={11} /> {p.subscribers}
                {p.onOldPrice > 0 && (
                  <span className="ml-1 text-warn" title={`${p.onOldPrice} cliente(s) ainda pagam um valor diferente de ${brl(p.priceMonth)}`}>
                    · {p.onOldPrice} no preço antigo
                  </span>
                )}
                {p.priceAppliesToExistingAt && (
                  <span className="ml-1 text-accent-ink" title="Reajuste avisado e agendado">
                    · reajusta {new Date(p.priceAppliesToExistingAt).toLocaleDateString('pt-BR')}
                  </span>
                )}
                {p.billingEnabled && !p.stripePriceId && p.isActive && (p.billingCycle === 'monthly' || p.billingCycle === 'yearly') && <span className="ml-2 text-warn" title="Sem preço no Stripe: o cliente não consegue assinar">· sem Stripe</span>}
              </span>
              <button onClick={() => setForm(toForm(p))} className="text-faint hover:text-ink p-1" title="Editar"><Pencil size={14} /></button>
              <button onClick={() => void alternarAtivo(p)} className="text-faint hover:text-ink p-1" title={p.isActive ? 'Desativar' : 'Ativar'}><Power size={14} /></button>
              <button
                onClick={() => setConfirmar(p)}
                disabled={p.subscribers > 0}
                className="text-faint hover:text-danger p-1 disabled:opacity-30 disabled:hover:text-faint"
                title={p.subscribers > 0 ? 'Tem cliente assinando: desative em vez de apagar' : 'Apagar'}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {form && (
        <FormularioPlano
          form={form}
          setForm={setForm}
          onSubmit={salvar}
          salvando={criar.isPending || atualizar.isPending}
          precoOriginal={plans.data?.find((p) => p.id === form.id && !p.isFree)?.priceMonth ?? null}
          assinantes={plans.data?.find((p) => p.id === form.id)?.subscribers ?? 0}
        />
      )}

      <ConfirmDialog
        open={!!confirmar}
        title="Apagar plano"
        text={`"${confirmar?.name}" será removido do catálogo. Só é possível porque ninguém assina este plano.`}
        confirmLabel="Apagar"
        danger
        onClose={() => setConfirmar(null)}
        onConfirm={async () => {
          try { await apagar.mutateAsync(confirmar!.id); toast.ok('Plano apagado'); } catch (err) { toast.err(err); }
          setConfirmar(null);
        }}
      />
    </PageShell>
  );
}

/**
 * O que acontece com quem já assina quando o preço muda.
 *
 * Sem esta escolha o cliente ficava congelado para sempre: no Stripe o preço de uma assinatura
 * não muda sozinho, então quem entrou hoje pagaria o preço de hoje daqui a dez anos. Por outro
 * lado, reajustar sem aviso não é opção — contrato de serviço continuado exige avisar antes, e
 * o cliente precisa poder sair se não aceitar. Daí a opção do meio ser a normal.
 */
function ReajusteDosAtuais({ aplicar, setAplicar, assinantes, de, para }: {
  aplicar: { mode: 'never' | 'scheduled' | 'now'; days?: number };
  setAplicar: (p: { mode?: 'never' | 'scheduled' | 'now'; days?: number }) => void;
  assinantes: number;
  de: number;
  para: number;
}) {
  const sobe = para > de;
  const um = assinantes === 1;
  const opcoes = [
    { id: 'never' as const, titulo: um ? 'Manter como está' : 'Manter como estão', desc: `${um ? 'Ele continua' : `Os ${assinantes} continuam`} em ${brl(de)}. O valor novo vale só para quem assinar daqui para frente.` },
    { id: 'scheduled' as const, titulo: 'Avisar e reajustar', desc: 'Avisa por e-mail hoje e muda na data. É o caminho normal.' },
    { id: 'now' as const, titulo: 'Aplicar agora', desc: 'Sem aviso prévio. Para corrigir preço digitado errado, não para reajustar.' },
  ];
  return (
    <div className="rounded-xl border border-warn/40 bg-warn-soft/40 p-3 space-y-2">
      <div className="text-[13px] font-semibold text-ink">
        {sobe ? 'Aumento' : 'Redução'} de {brl(de)} para {brl(para)} — e {um ? 'o cliente que já assina' : `os ${assinantes} clientes que já assinam`}?
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        {opcoes.map((o) => (
          <button key={o.id} type="button" onClick={() => setAplicar({ mode: o.id })} className={cn('text-left rounded-lg border p-2', aplicar.mode === o.id ? 'border-accent bg-panel' : 'border-line bg-panel/60 hover:bg-panel')}>
            <div className="text-[12.5px] font-semibold text-ink">{o.titulo}</div>
            <div className="text-[11px] text-muted">{o.desc}</div>
          </button>
        ))}
      </div>
      {aplicar.mode === 'scheduled' && (
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          Aviso prévio de
          <input className={cn(inputCls, 'w-20 py-1')} inputMode="numeric" value={String(aplicar.days ?? 30)} onChange={(e) => setAplicar({ days: Number(e.target.value) || 0 })} />
          dias — passa a valer em <b>{new Date(Date.now() + (aplicar.days ?? 30) * 86_400_000).toLocaleDateString('pt-BR')}</b>
        </label>
      )}
      {aplicar.mode !== 'never' && (
        <p className="text-[11px] text-muted">
          Cada cliente recebe e-mail com o valor antigo, o novo e a data. A cobrança muda na primeira fatura depois dessa data — sem valor proporcional no meio do mês.
        </p>
      )}
    </div>
  );
}

function FormularioPlano({ form, setForm, onSubmit, salvando, precoOriginal, assinantes }: {
  form: PlanInput & { id?: string };
  setForm: (f: (PlanInput & { id?: string }) | null) => void;
  onSubmit: (e: React.FormEvent) => void;
  salvando: boolean;
  precoOriginal: number | null;
  assinantes: number;
}) {
  const lim = (patch: Partial<PlanLimits>) => setForm({ ...form, limits: { ...form.limits, ...patch } });
  const gratis = !!form.isFree;
  const ciclo: BillingCycle = gratis ? 'free' : (form.billingCycle ?? 'monthly');
  const anual = ciclo === 'yearly';
  // sem fatura no Stripe não há pagamento que falhe — a tolerância não se aplica
  const semFatura = gratis || ciclo === 'custom';
  // a API recusa trocar a modalidade com gente assinando (ver billing.controller): travar aqui
  // evita o cliente descobrir isso só no "Salvar"
  const travaModalidade = !!form.id && assinantes > 0;
  // mensalidade que a API vai gravar: no anual é o equivalente mensal
  const mensal = anual ? centavos((form.priceYear ?? 0) / 12) : form.priceMonth;
  // a pergunta do reajuste só faz sentido quando há preço anterior, ele mudou, e existe gente
  // pagando o antigo — perguntar fora disso é ruído num formulário que já é grande
  const mudouPreco = !gratis && precoOriginal !== null && mensal !== precoOriginal && assinantes > 0;
  const aplicar = form.applyToExisting ?? { mode: 'never' as const, days: 30 };
  const setAplicar = (p: Partial<NonNullable<PlanInput['applyToExisting']>>) => setForm({ ...form, applyToExisting: { ...aplicar, ...p } });
  const porConversa = form.limits.billingUnit === 'conversations';
  const features = form.limits.features ?? [];

  /** Ligar "gratuito" zera os preços e trava a quota: plano sem fatura não tem onde cobrar excedente. */
  function alternarGratis(on: boolean) {
    if (on) setForm({ ...form, isFree: true, billingCycle: 'free', priceMonth: 0, priceYear: null, billingModel: 'fixed', limits: { ...form.limits, hardLimit: true } });
    else setForm({ ...form, isFree: false, billingCycle: 'monthly', durationDays: null });
  }

  return (
    <Modal open onClose={() => setForm(null)} title={form.id ? 'Editar plano' : 'Novo plano'} width="max-w-2xl">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className={cn('flex items-start gap-3 rounded-xl border p-3', gratis ? 'border-ok/50 bg-ok-soft/40' : 'border-line', travaModalidade ? 'opacity-60' : 'cursor-pointer')}>
          <input type="checkbox" className="mt-1" checked={gratis} disabled={travaModalidade} onChange={(e) => alternarGratis(e.target.checked)} />
          <span className="flex-1">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink"><Gift size={14} /> Plano gratuito</span>
            <span className="block text-[11px] text-muted">
              {travaModalidade
                ? `${assinantes} cliente(s) neste plano: para mudar a modalidade, crie um plano novo e troque os clientes.`
                : 'Sem cartão, sem Stripe e sem fatura. A assinatura nasce ativa. Para cortesia, degustação ou freemium.'}
            </span>
          </span>
        </label>

        {gratis && (
          <Field label="Duração da gratuidade">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setForm({ ...form, durationDays: null })} className={cn('rounded-lg border px-3 py-1.5 text-[13px]', form.durationDays == null ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>Permanente</button>
              <button type="button" onClick={() => setForm({ ...form, durationDays: form.durationDays ?? 14 })} className={cn('rounded-lg border px-3 py-1.5 text-[13px]', form.durationDays != null ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>Por período</button>
              {form.durationDays != null && (
                <label className="flex items-center gap-2 text-[13px] text-ink">
                  <input className={cn(inputCls, 'w-20 py-1')} inputMode="numeric" value={String(form.durationDays)} onChange={(e) => setForm({ ...form, durationDays: Math.max(1, Number(e.target.value) || 1) })} />
                  dias — depois o envio é pausado até o cliente assinar um plano pago
                </label>
              )}
            </div>
          </Field>
        )}

        {!gratis && (
          <Field label="Modalidade de cobrança">
            <div className="grid sm:grid-cols-3 gap-2">
              {CICLOS.map((c) => (
                <button key={c.id} type="button" disabled={travaModalidade && c.id !== ciclo} onClick={() => setForm({ ...form, billingCycle: c.id, priceYear: c.id === 'yearly' ? (form.priceYear ?? centavos(form.priceMonth * 12)) : null })} className={cn('text-left rounded-xl border p-2.5 disabled:opacity-40', ciclo === c.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-field')}>
                  <div className="text-[13px] font-semibold text-ink">{BILLING_CYCLE_LABEL[c.id]}</div>
                  <div className="text-[11px] text-muted">{c.desc}</div>
                </button>
              ))}
            </div>
          </Field>
        )}

        <div className="grid sm:grid-cols-3 gap-3 items-start">
          <Field label="Nome"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} required autoFocus placeholder="Starter, Pro, Cortesia…" /></Field>
          {anual ? (
            <Field label="Anuidade (R$)" hint={`Equivale a ${brl(mensal)}/mês — é o valor que entra no MRR.${form.id ? ' Mudar cria um preço novo no Stripe.' : ''}`}>
              <MoneyInput value={form.priceYear ?? 0} onChange={(v) => setForm({ ...form, priceYear: v ?? 0 })} required />
            </Field>
          ) : (
            <Field label="Mensalidade (R$)" hint={gratis ? 'Plano gratuito: sem cobrança.' : form.id && ciclo === 'monthly' ? 'Mudar o valor cria um preço novo no Stripe.' : undefined}>
              <MoneyInput className={cn(gratis && 'opacity-60')} disabled={gratis} value={gratis ? 0 : form.priceMonth} onChange={(v) => setForm({ ...form, priceMonth: v ?? 0 })} required />
            </Field>
          )}
          <Field label="Custo por cliente (R$/mês)" hint="O que te custa servir um cliente deste plano: suporte, infra rateada, licenças. É o que faz a margem por plano existir no Financeiro.">
            <MoneyInput value={form.costMonth ?? 0} onChange={(v) => setForm({ ...form, costMonth: v ?? 0 })} />
          </Field>
        </div>

        {mudouPreco && <ReajusteDosAtuais aplicar={aplicar} setAplicar={setAplicar} assinantes={assinantes} de={precoOriginal!} para={mensal} />}

        {!gratis && (
          <Field label="Modelo de cobrança">
            <div className="grid sm:grid-cols-3 gap-2">
              {MODELOS.map((m) => (
                <button key={m.id} type="button" onClick={() => setForm({ ...form, billingModel: m.id })} className={cn('text-left rounded-xl border p-2.5', form.billingModel === m.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-field')}>
                  <div className="text-[13px] font-semibold text-ink">{m.label}</div>
                  <div className="text-[11px] text-muted">{m.desc}</div>
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="O que conta para a quota" hint="A conversa é a janela de 24h com o mesmo contato — é como a Meta cobra. O ledger registra as duas sempre; isto decide qual limita.">
          <div className="flex gap-2">
            {([['conversations', 'Conversas'], ['messages', 'Mensagens enviadas']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => lim({ billingUnit: id })} className={cn('rounded-lg border px-3 py-1.5 text-[13px]', form.limits.billingUnit === id ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>{label}</button>
            ))}
          </div>
        </Field>

        <div className="grid sm:grid-cols-2 gap-3 items-start">
          {porConversa
            ? <Limite rotulo="Conversas/mês" chave="includedConversationsMonth" limits={form.limits} lim={lim} padrao={500} />
            : <Limite rotulo="Mensagens/mês" chave="includedMessagesMonth" limits={form.limits} lim={lim} padrao={2000} />}
          <Limite
            rotulo="Templates/mês"
            chave="includedTemplatesMonth"
            limits={form.limits}
            lim={lim}
            padrao={100}
            aviso="Cada template custa à Meta: ilimitado é custo sem teto."
          />
        </div>

        <Field label="Limites de quantidade" hint="Checados na hora de criar (ou ativar, no caso dos fluxos). O que já existe acima do limite continua funcionando.">
          <div className="grid sm:grid-cols-4 gap-3 items-start">
            <Limite rotulo="Números (conexões)" chave="maxNumbers" limits={form.limits} lim={lim} padrao={1} />
            <Limite rotulo="Usuários" chave="maxAgents" limits={form.limits} lim={lim} padrao={2} />
            <Limite rotulo="Fluxos ativos" chave="maxFlows" limits={form.limits} lim={lim} padrao={5} />
            <Limite rotulo="Respostas rápidas" chave="maxQuickReplies" limits={form.limits} lim={lim} padrao={50} />
          </div>
        </Field>

        {!gratis && (<>
        <Field label="Ao estourar o incluído" hint="Bloquear protege o cliente de uma conta surpresa; cobrar excedente mantém o atendimento de pé. Escolha sabendo qual dos dois dói menos para esse cliente.">
          <div className="flex gap-2">
            <button type="button" onClick={() => lim({ hardLimit: true })} className={cn('rounded-lg border px-3 py-1.5 text-[13px]', form.limits.hardLimit ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>Bloquear envios</button>
            <button type="button" onClick={() => lim({ hardLimit: false })} className={cn('rounded-lg border px-3 py-1.5 text-[13px]', !form.limits.hardLimit ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>Cobrar excedente</button>
          </div>
        </Field>

        {!form.limits.hardLimit && (
          <div className="grid sm:grid-cols-2 gap-3 items-start">
            <Field label={porConversa ? 'R$ por conversa extra' : 'R$ por mensagem extra'}>
              {/* por mensagem costuma ser fração de centavo: 3 casas */}
              <MoneyInput
                nullable
                decimals={porConversa ? 2 : 3}
                value={porConversa ? form.limits.overagePricePerConversation : form.limits.overagePricePerMessage}
                onChange={(v) => lim(porConversa ? { overagePricePerConversation: v } : { overagePricePerMessage: v })}
              />
            </Field>
            <Field label="R$ por template extra">
              <MoneyInput nullable value={form.limits.overagePricePerTemplate} onChange={(v) => lim({ overagePricePerTemplate: v })} />
            </Field>
          </div>
        )}

        </>)}

        {!semFatura && (
        <Field label="Dias de tolerância no pagamento" hint="Depois que o pagamento falha, quantos dias o cliente continua atendendo antes de suspender. Vale para qualquer modelo de cobrança — é sobre a fatura, não sobre a quota.">
          {/* `block` junto com a largura menor: `inputCls` é `w-full`, e trocar a largura sem
              isso faz o campo virar inline e subir para a mesma linha do rótulo — ficava o
              único campo do formulário fora do padrão */}
          <input className={cn(inputCls, 'block sm:w-32')} inputMode="numeric" value={String(form.limits.graceDays)} onChange={(e) => lim({ graceDays: Number(e.target.value) || 0 })} />
        </Field>
        )}

        <Field label="Funcionalidades liberadas" hint="É isto que destrava o módulo na API e no painel (IA inclusive: Copiloto = sugestão, reescrita e resumo; IA nos fluxos = robô). Sem marcar, o cliente nem vê a tela.">
          <div className="flex flex-wrap gap-2">
            {PLAN_FEATURES.map((f) => {
              const on = features.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => lim({ features: on ? features.filter((x) => x !== f) : [...features, f as PlanFeature] })}
                  className={cn('rounded-lg border px-3 py-1.5 text-[13px]', on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}
                >
                  {PLAN_FEATURE_LABEL[f]}
                </button>
              );
            })}
          </div>
        </Field>

        {(features.includes('ai_copilot') || features.includes('ai_flows')) && (
          <div className="grid sm:grid-cols-3 gap-3 items-start">
            <Field label="Interações de IA/mês"><input className={inputCls} inputMode="numeric" value={String(form.limits.includedAiInteractionsMonth ?? 0)} onChange={(e) => lim({ includedAiInteractionsMonth: Number(e.target.value) || 0 })} /></Field>
            {!gratis && <Field label="R$ por interação extra"><MoneyInput nullable decimals={3} value={form.limits.overagePricePerAiInteraction} onChange={(v) => lim({ overagePricePerAiInteraction: v })} /></Field>}
            <Field label="Teto de custo de IA (R$)" hint="Corta o uso mesmo pagando excedente: a IA pode entrar em laço e queimar dinheiro em minutos.">
              <MoneyInput nullable value={form.limits.aiMonthlyCostCap} onChange={(v) => lim({ aiMonthlyCostCap: v ?? undefined })} />
            </Field>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
          <Button type="submit" loading={salvando} loadingText="Salvando…">Salvar plano</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Campos numéricos do plano que aceitam "Ilimitado" (`null`). */
type ChaveIlimitavel = CountLimit | 'includedMessagesMonth' | 'includedConversationsMonth' | 'includedTemplatesMonth';

/** Um limite com a opção "Ilimitado" (grava `null`). */
function Limite({ rotulo, chave, limits, lim, padrao, aviso }: { rotulo: string; chave: ChaveIlimitavel; limits: PlanLimits; lim: (p: Partial<PlanLimits>) => void; padrao: number; aviso?: string }) {
  const v = limits[chave];
  // conversas ausentes = 0 (planos antigos limitavam por mensagem); nos limites de quantidade, ausente = ilimitado
  const ilimitado = v === null || (v === undefined && chave !== 'includedConversationsMonth');
  return (
    <div className="space-y-1">
      <div className="text-[12px] text-muted">{rotulo}</div>
      <input className={cn(inputCls, ilimitado && 'opacity-50')} inputMode="numeric" disabled={ilimitado} value={ilimitado ? '∞' : String(v ?? 0)} onChange={(e) => lim({ [chave]: Number(e.target.value) || 0 } as Partial<PlanLimits>)} />
      <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer">
        <input type="checkbox" checked={ilimitado} onChange={(e) => lim({ [chave]: e.target.checked ? null : padrao } as Partial<PlanLimits>)} /> Ilimitado
      </label>
      {ilimitado && aviso && <p className="text-[11px] text-warn-ink">{aviso}</p>}
    </div>
  );
}
