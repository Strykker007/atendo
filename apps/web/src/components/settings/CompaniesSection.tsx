'use client';
import { useState } from 'react';
import { Store, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { useAgents, useNumbers, useUsage, useCompanies, useCreateCompany, useUpdateCompany, useDeleteCompany, useAdminCompanies, useAdminCompanyOptions, useAdminCreateCompany, useAdminUpdateCompany, useAdminDeleteCompany, useAdminCompanyBilling, usePlans, type Company, type CompanyInput, type CompanyBillingInput } from '@/lib/hooks';

type Draft = { id?: string; name: string; cnpj: string; description: string; numberIds: string[]; userIds: string[] };

/** 00.000.000/0000-00 enquanto digita; a API guarda só os dígitos. */
function mascaraCnpj(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

type Mut<T> = { mutateAsync: (v: T) => Promise<unknown>; isPending: boolean };
interface Source {
  companies: Company[];
  loading: boolean;
  numbers: { id: string; label: string; phone: string }[];
  people: { id: string; name: string; isActive: boolean }[];
  max: number | null;
  create: Mut<CompanyInput>;
  update: Mut<Partial<CompanyInput> & { id: string }>;
  remove: Mut<string>;
  /** dono do sistema: pode passar do limite do plano (só avisa) */
  owner?: boolean;
  /** só o dono: assinatura própria ou herdada do grupo (docs/empresas.md#cobrança) */
  billing?: Mut<CompanyBillingInput>;
}

/**
 * Empresas/unidades (matriz, filial Centro…): cada uma agrupa números de WhatsApp, e quem opera
 * a unidade enxerga só as conversas desses números. Quantas cabem vem do plano. Ver docs/empresas.md.
 *
 * Sem `tenantId`: a conta logada (Configurações). Com `tenantId`: o dono mexendo no cliente pela
 * tela Clientes, sem "Entrar como".
 */
export function CompaniesSection({ tenantId }: { tenantId?: string } = {}) {
  return tenantId ? <OwnerCompanies tenantId={tenantId} /> : <TenantCompanies />;
}

function TenantCompanies() {
  const companies = useCompanies();
  const numbers = useNumbers();
  const agents = useAgents();
  const usage = useUsage();
  const create = useCreateCompany();
  const update = useUpdateCompany();
  const remove = useDeleteCompany();
  return <CompaniesView companies={companies.data ?? []} loading={companies.isLoading} numbers={numbers.data ?? []} people={agents.data ?? []} max={usage.data?.limits?.maxCompanies ?? null} create={create} update={update} remove={remove} />;
}

function OwnerCompanies({ tenantId }: { tenantId: string }) {
  const companies = useAdminCompanies(tenantId);
  const opts = useAdminCompanyOptions(tenantId);
  const create = useAdminCreateCompany(tenantId);
  const update = useAdminUpdateCompany(tenantId);
  const remove = useAdminDeleteCompany(tenantId);
  const billing = useAdminCompanyBilling(tenantId);
  return <CompaniesView owner billing={billing} companies={companies.data ?? []} loading={companies.isLoading} numbers={opts.data?.numbers ?? []} people={opts.data?.users ?? []} max={opts.data?.maxCompanies ?? null} create={create} update={update} remove={remove} />;
}

function CompaniesView({ companies: lista, loading, numbers, people, max, create, update, remove, owner, billing }: Source) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [cobranca, setCobranca] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const cheio = max !== null && lista.length >= max;
  const pessoas = people.filter((a) => a.isActive || editing?.userIds.includes(a.id));
  // número de outra empresa aparece com o nome dela: marcar aqui MOVE o número
  const donoDoNumero = new Map(lista.flatMap((c) => c.numbers.map((n) => [n.id, c] as const)));

  function abrir(c?: Company) {
    setEditing(c
      ? { id: c.id, name: c.name, cnpj: c.cnpj ? mascaraCnpj(c.cnpj) : '', description: c.description ?? '', numberIds: c.numbers.map((n) => n.id), userIds: c.users.map((u) => u.user.id) }
      : { name: '', cnpj: '', description: '', numberIds: [], userIds: [] });
  }

  async function salvar() {
    if (!editing) return;
    const body = { name: editing.name.trim(), cnpj: editing.cnpj || null, description: editing.description.trim() || null, numberIds: editing.numberIds, userIds: editing.userIds };
    try {
      if (editing.id) await update.mutateAsync({ id: editing.id, ...body });
      else await create.mutateAsync(body);
      toast.ok('Empresa salva');
      setEditing(null);
    } catch (e) {
      toast.err(e);
    }
  }

  const toggle = (campo: 'numberIds' | 'userIds', id: string, on: boolean) =>
    editing && setEditing({ ...editing, [campo]: on ? [...editing[campo], id] : editing[campo].filter((x) => x !== id) });

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-semibold text-ink">Empresas e unidades</h2>
          <p className="text-sm text-muted">
            Separe matriz e filiais. Cada empresa reúne números de WhatsApp; quem é vinculado a ela vê só as conversas desses números
            e alterna entre as suas unidades pelo seletor no menu. Sem empresas, todo mundo vê todos os números.
            {max !== null && (owner
              ? <> O plano deste cliente permite <b className="text-ink">{max}</b> empresa(s){lista.length > max && <span className="text-warn-ink"> — já está acima, por decisão sua</span>}.</>
              : <> Seu plano permite <b className="text-ink">{max}</b> empresa(s).</>)}
          </p>
        </div>
        <Button onClick={() => abrir()} icon={<Plus size={16} />} disabled={cheio && !owner} title={cheio ? (owner ? 'Acima do limite do plano — você pode criar mesmo assim' : 'Limite do plano atingido') : undefined}>Nova empresa</Button>
      </div>

      {loading && <div className="h-12 rounded-lg bg-field animate-pulse" />}
      {!loading && lista.length === 0 && <p className="text-sm text-muted rounded-lg bg-field px-3 py-3">Nenhuma empresa cadastrada.</p>}

      <ul className="divide-y divide-line">
        {lista.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2.5">
            <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 bg-accent-soft text-accent"><Store size={16} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink truncate">{c.name}{c.cnpj && <span className="ml-1.5 text-[11px] font-normal text-muted tnum">{mascaraCnpj(c.cnpj)}</span>}</div>
              <div className="text-xs text-muted truncate">
                {c.numbers.length ? c.numbers.map((n) => n.label).join(', ') : 'Nenhum número'} · {c.users.length ? `${c.users.length} pessoa(s)` : 'ninguém vinculado'}
              </div>
              <div className="text-[11px] text-faint truncate">{resumoCobranca(c)}</div>
            </div>
            {/* com rótulo: só o ícone de carteira, ninguém achava onde se escolhe o plano da empresa */}
            {billing && <Button size="sm" variant="ghost" icon={<Wallet size={13} />} onClick={() => setCobranca(c)} title="Plano e cobrança desta empresa">Plano</Button>}
            <button onClick={() => abrir(c)} className="p-1.5 rounded-md text-faint hover:text-ink hover:bg-field" title="Editar"><Pencil size={15} /></button>
            <button onClick={() => setDeleting(c)} className="p-1.5 rounded-md text-faint hover:text-danger hover:bg-field" title="Excluir"><Trash2 size={15} /></button>
          </li>
        ))}
      </ul>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar empresa' : 'Nova empresa'}>
        {editing && (
          <form onSubmit={(e) => { e.preventDefault(); void salvar(); }} className="space-y-3">
            <Field label="Nome"><input className={inputCls} value={editing.name} maxLength={60} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Filial Centro" required autoFocus /></Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="CNPJ (opcional)"><input className={inputCls} value={editing.cnpj} inputMode="numeric" onChange={(e) => setEditing({ ...editing, cnpj: mascaraCnpj(e.target.value) })} placeholder="00.000.000/0000-00" /></Field>
              <Field label="Descrição (opcional)"><input className={inputCls} value={editing.description} maxLength={200} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Loja da Av. Brasil" /></Field>
            </div>
            <Field label="Números" hint="Um número pertence a uma empresa só: marcar aqui tira ele da outra.">
              <div className="max-h-44 overflow-y-auto rounded-lg border border-line divide-y divide-line">
                {numbers.length === 0 && <div className="px-3 py-2 text-xs text-muted">Nenhum número cadastrado.</div>}
                {numbers.map((n) => {
                  const outra = donoDoNumero.get(n.id);
                  return (
                    <label key={n.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink cursor-pointer hover:bg-field">
                      <input type="checkbox" checked={editing.numberIds.includes(n.id)} onChange={(e) => toggle('numberIds', n.id, e.target.checked)} />
                      <span className="truncate">{n.label} <span className="text-muted">· {n.phone}</span></span>
                      {outra && outra.id !== editing.id && <span className="ml-auto text-[11px] text-muted shrink-0">em {outra.name}</span>}
                    </label>
                  );
                })}
              </div>
            </Field>
            <Field label="Quem opera esta empresa" hint="Pessoa sem nenhuma empresa marcada continua vendo todas.">
              <div className="max-h-44 overflow-y-auto rounded-lg border border-line divide-y divide-line">
                {pessoas.length === 0 && <div className="px-3 py-2 text-xs text-muted">Nenhum membro na equipe.</div>}
                {pessoas.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink cursor-pointer hover:bg-field">
                    <input type="checkbox" checked={editing.userIds.includes(a.id)} onChange={(e) => toggle('userIds', a.id, e.target.checked)} />
                    <span className="truncate">{a.name}</span>
                    {!a.isActive && <span className="text-[11px] text-muted">(inativo)</span>}
                  </label>
                ))}
              </div>
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button type="submit" loading={create.isPending || update.isPending} loadingText="Salvando…" disabled={!editing.name.trim()}>Salvar</Button>
            </div>
          </form>
        )}
      </Modal>

      {billing && cobranca && <BillingModal company={cobranca} billing={billing} onClose={() => setCobranca(null)} />}

      <ConfirmDialog
        open={!!deleting}
        title="Excluir empresa"
        text={`Excluir "${deleting?.name}"? Os números dela ficam sem empresa (conversas e histórico continuam) e quem estava vinculado só a ela passa a ver todos os números.`}
        confirmLabel="Excluir"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          try { await remove.mutateAsync(deleting.id); toast.ok('Empresa excluída'); } catch (e) { toast.err(e); throw e; }
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

const STATUS_ASSINATURA: Record<string, string> = { trialing: 'Em teste', active: 'Ativa', past_due: 'Pagamento pendente', suspended: 'Suspensa', canceled: 'Cancelada' };
const diaSP = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString().slice(0, 10);

function resumoCobranca(c: Company) {
  if (!c.isActive) return 'Inativa para cobrança';
  if (c.billingType === 'CONSOLIDATED_GROUP') return 'Plano: o do grupo (paga junto com o cliente)';
  if (!c.subscription) return 'Plano próprio: ainda não escolhido';
  return `Plano próprio: ${c.subscription.plan.name} · ${STATUS_ASSINATURA[c.subscription.status] ?? c.subscription.status} · vence ${new Date(c.subscription.currentPeriodEnd).toLocaleDateString('pt-BR')}`;
}

type BillingCompany = Pick<Company, 'id' | 'name' | 'billingType' | 'isActive' | 'subscription'>;

/** Plano/cobrança de uma empresa aberto direto da tabela de Clientes (sem passar pela lista de empresas). */
export function CompanyBillingDialog({ tenantId, company, groupPlan, onClose }: { tenantId: string; company: BillingCompany; groupPlan?: string; onClose: () => void }) {
  const billing = useAdminCompanyBilling(tenantId);
  return <BillingModal company={company} billing={billing} groupPlan={groupPlan} onClose={onClose} />;
}

/**
 * Cobrança da empresa (só o dono): herda a assinatura do cliente ou tem a própria, com plano,
 * preço, vencimento e status. Suspensa/cancelada para o envio dos números dela.
 */
function BillingModal({ company, billing, groupPlan, onClose }: { company: BillingCompany; billing: Mut<CompanyBillingInput>; groupPlan?: string; onClose: () => void }) {
  const plans = usePlans();
  const sub = company.subscription;
  const [f, setF] = useState({
    billingType: company.billingType,
    isActive: company.isActive,
    planId: sub?.planId ?? '',
    priceMonth: sub?.priceMonth != null ? Number(sub.priceMonth) : null as number | null,
    currentPeriodEnd: sub ? diaSP(sub.currentPeriodEnd) : '',
    status: sub?.status ?? 'active',
  });
  const propria = f.billingType === 'INDIVIDUAL';

  async function salvar() {
    try {
      await billing.mutateAsync({
        id: company.id,
        billingType: f.billingType,
        isActive: f.isActive,
        ...(propria && { planId: f.planId || undefined, priceMonth: f.priceMonth, status: f.status, ...(f.currentPeriodEnd && { currentPeriodEnd: f.currentPeriodEnd }) }),
      });
      toast.ok('Cobrança da empresa salva');
      onClose();
    } catch (e) {
      toast.err(e);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Plano e cobrança — ${company.name}`}>
      <form onSubmit={(e) => { e.preventDefault(); void salvar(); }} className="space-y-3">
        <Field label="Plano da empresa" hint={propria ? 'A empresa tem plano, vencimento e valor próprios, pagos no painel de vencimentos do cliente. Limites de uso (números, mensagens) continuam vindo do plano do grupo.' : `Usa o plano do grupo${groupPlan ? ` (${groupPlan})` : ''} e paga junto com a assinatura do cliente. No modo grupo, conta como uma unidade no valor.`}>
          <select className={inputCls} value={f.billingType} onChange={(e) => setF({ ...f, billingType: e.target.value as Company['billingType'] })}>
            <option value="CONSOLIDATED_GROUP">Usa o plano do grupo{groupPlan ? ` — ${groupPlan}` : ''}</option>
            <option value="INDIVIDUAL">Plano próprio</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          Ativa para cobrança <span className="text-xs text-muted">(inativa não entra no valor do grupo nem gera vencimento)</span>
        </label>
        {propria && (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Plano">
                <select className={inputCls} value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })} required>
                  <option value="">Escolha…</option>
                  {plans.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Valor mensal contratado" hint="Vazio = o preço do plano.">
                <MoneyInput className={inputCls} value={f.priceMonth} onChange={(v) => setF({ ...f, priceMonth: v })} nullable placeholder="do plano" />
              </Field>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Próximo vencimento" hint="Vazio na criação = daqui a um ciclo.">
                <input type="date" className={inputCls} value={f.currentPeriodEnd} onChange={(e) => setF({ ...f, currentPeriodEnd: e.target.value })} />
              </Field>
              <Field label="Status" hint="Suspensa ou cancelada bloqueia o envio dos números desta empresa.">
                <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                  {Object.entries(STATUS_ASSINATURA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={billing.isPending} loadingText="Salvando…" disabled={propria && !f.planId}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
