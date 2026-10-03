'use client';
import { useState } from 'react';
import { Plus, Package, Pencil, Power, Trash2, Users } from 'lucide-react';
import { PLAN_FEATURES, PLAN_FEATURE_LABEL, type PlanFeature, type PlanLimits } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { useAllPlans, useCreatePlan, useUpdatePlan, useDeletePlan, useMe, type PlanInput, type PlanRow } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const MODELOS: { id: PlanInput['billingModel']; label: string; desc: string }[] = [
  { id: 'fixed', label: 'Fixo', desc: 'Mensalidade só. Estourou o limite, bloqueia.' },
  { id: 'hybrid', label: 'Híbrido', desc: 'Mensalidade + excedente por uso acima do incluído.' },
  { id: 'usage', label: 'Por uso', desc: 'Cobrança acompanha o consumo.' },
];

/** Plano novo começa parecido com o Starter: é mais fácil baixar números do que inventá-los. */
const PADRAO: PlanInput = {
  name: '',
  priceMonth: 97,
  billingModel: 'fixed',
  limits: {
    maxNumbers: 1,
    maxAgents: 2,
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
      if (!salvo.stripePriceId && salvo.isActive) toast.ok('Plano salvo. Ainda sem preço no Stripe — se a cobrança estiver ligada, veja o log da API.');
      else toast.ok('Plano salvo');
      setForm(null);
    } catch (err) { toast.err(err); }
  }
  async function alternarAtivo(p: PlanRow) {
    try {
      await atualizar.mutateAsync({ id: p.id, name: p.name, priceMonth: p.priceMonth, billingModel: p.billingModel, limits: p.limits, isActive: !p.isActive });
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
                <div className="font-display font-semibold text-ink truncate">{p.name}</div>
                <div className="text-[11px] text-faint">{MODELOS.find((m) => m.id === p.billingModel)?.label}{!p.isActive && ' · inativo'}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-display font-semibold text-ink tnum">{brl(p.priceMonth)}</div>
                <div className="text-[10px] text-faint">por mês</div>
              </div>
            </div>

            <ul className="text-[12px] text-muted space-y-0.5">
              <li>{p.limits.maxNumbers} número(s) · {p.limits.maxAgents} usuário(s)</li>
              <li>
                {p.limits.billingUnit === 'conversations'
                  ? `${(p.limits.includedConversationsMonth ?? 0).toLocaleString('pt-BR')} conversas/mês`
                  : `${p.limits.includedMessagesMonth.toLocaleString('pt-BR')} mensagens/mês`}
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
                {p.billingEnabled && !p.stripePriceId && p.isActive && <span className="ml-2 text-warn" title="Sem preço no Stripe: o cliente não consegue assinar">· sem Stripe</span>}
              </span>
              <button onClick={() => setForm({ id: p.id, name: p.name, priceMonth: p.priceMonth, billingModel: p.billingModel, limits: p.limits, isActive: p.isActive })} className="text-faint hover:text-ink p-1" title="Editar"><Pencil size={14} /></button>
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

      {form && <FormularioPlano form={form} setForm={setForm} onSubmit={salvar} salvando={criar.isPending || atualizar.isPending} />}

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

function FormularioPlano({ form, setForm, onSubmit, salvando }: {
  form: PlanInput & { id?: string };
  setForm: (f: (PlanInput & { id?: string }) | null) => void;
  onSubmit: (e: React.FormEvent) => void;
  salvando: boolean;
}) {
  const lim = (patch: Partial<PlanLimits>) => setForm({ ...form, limits: { ...form.limits, ...patch } });
  const porConversa = form.limits.billingUnit === 'conversations';
  const features = form.limits.features ?? [];

  return (
    <Modal open onClose={() => setForm(null)} title={form.id ? 'Editar plano' : 'Novo plano'} width="max-w-2xl">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3 items-start">
          <Field label="Nome"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} required autoFocus placeholder="Starter, Pro, Farmácia…" /></Field>
          <Field label="Mensalidade (R$)" hint={form.id ? 'Mudar o valor cria um preço novo no Stripe. Quem já assina continua no antigo até trocar de plano.' : undefined}>
            <input className={inputCls} inputMode="decimal" value={String(form.priceMonth)} onChange={(e) => setForm({ ...form, priceMonth: Number(e.target.value.replace(',', '.')) || 0 })} required />
          </Field>
        </div>

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

        <Field label="O que conta para a quota" hint="A conversa é a janela de 24h com o mesmo contato — é como a Meta cobra. O ledger registra as duas sempre; isto decide qual limita.">
          <div className="flex gap-2">
            {([['conversations', 'Conversas'], ['messages', 'Mensagens enviadas']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => lim({ billingUnit: id })} className={cn('rounded-lg border px-3 py-1.5 text-[13px]', form.limits.billingUnit === id ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>{label}</button>
            ))}
          </div>
        </Field>

        <div className="grid sm:grid-cols-4 gap-3 items-start">
          <Field label="Números"><input className={inputCls} inputMode="numeric" value={String(form.limits.maxNumbers)} onChange={(e) => lim({ maxNumbers: Number(e.target.value) || 0 })} /></Field>
          <Field label="Usuários"><input className={inputCls} inputMode="numeric" value={String(form.limits.maxAgents)} onChange={(e) => lim({ maxAgents: Number(e.target.value) || 0 })} /></Field>
          <Field label={porConversa ? 'Conversas/mês' : 'Mensagens/mês'}>
            <input
              className={inputCls}
              inputMode="numeric"
              value={String(porConversa ? form.limits.includedConversationsMonth ?? 0 : form.limits.includedMessagesMonth)}
              onChange={(e) => lim(porConversa ? { includedConversationsMonth: Number(e.target.value) || 0 } : { includedMessagesMonth: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Templates/mês"><input className={inputCls} inputMode="numeric" value={String(form.limits.includedTemplatesMonth)} onChange={(e) => lim({ includedTemplatesMonth: Number(e.target.value) || 0 })} /></Field>
        </div>

        <Field label="Ao estourar o incluído" hint="Bloquear protege o cliente de uma conta surpresa; cobrar excedente mantém o atendimento de pé. Escolha sabendo qual dos dois dói menos para esse cliente.">
          <div className="flex gap-2">
            <button type="button" onClick={() => lim({ hardLimit: true })} className={cn('rounded-lg border px-3 py-1.5 text-[13px]', form.limits.hardLimit ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>Bloquear envios</button>
            <button type="button" onClick={() => lim({ hardLimit: false })} className={cn('rounded-lg border px-3 py-1.5 text-[13px]', !form.limits.hardLimit ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>Cobrar excedente</button>
          </div>
        </Field>

        {!form.limits.hardLimit && (
          <div className="grid sm:grid-cols-2 gap-3 items-start">
            <Field label={porConversa ? 'R$ por conversa extra' : 'R$ por mensagem extra'}>
              <input
                className={inputCls}
                inputMode="decimal"
                value={String((porConversa ? form.limits.overagePricePerConversation : form.limits.overagePricePerMessage) ?? '')}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) || 0;
                  lim(porConversa ? { overagePricePerConversation: v } : { overagePricePerMessage: v });
                }}
              />
            </Field>
            <Field label="R$ por template extra">
              <input className={inputCls} inputMode="decimal" value={String(form.limits.overagePricePerTemplate ?? '')} onChange={(e) => lim({ overagePricePerTemplate: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) || 0 })} />
            </Field>
          </div>
        )}

        <Field label="Dias de tolerância no pagamento" hint="Depois que o pagamento falha, quantos dias o cliente continua atendendo antes de suspender. Vale para qualquer modelo de cobrança — é sobre a fatura, não sobre a quota.">
          <input className={cn(inputCls, 'sm:w-32')} inputMode="numeric" value={String(form.limits.graceDays)} onChange={(e) => lim({ graceDays: Number(e.target.value) || 0 })} />
        </Field>

        <Field label="Funcionalidades liberadas" hint="É isto que destrava o módulo na API e no painel. Sem marcar, o cliente nem vê a tela.">
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
            <Field label="R$ por interação extra"><input className={inputCls} inputMode="decimal" value={String(form.limits.overagePricePerAiInteraction ?? '')} onChange={(e) => lim({ overagePricePerAiInteraction: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) || 0 })} /></Field>
            <Field label="Teto de custo de IA (R$)" hint="Corta o uso mesmo pagando excedente: a IA pode entrar em laço e queimar dinheiro em minutos.">
              <input className={inputCls} inputMode="decimal" value={String(form.limits.aiMonthlyCostCap ?? '')} onChange={(e) => lim({ aiMonthlyCostCap: e.target.value === '' ? undefined : Number(e.target.value.replace(',', '.')) || 0 })} />
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
