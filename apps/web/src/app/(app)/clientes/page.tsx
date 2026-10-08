'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus, Building2, Eye, Power, Pencil, Store } from 'lucide-react';
import { CompaniesSection } from '@/components/settings/CompaniesSection';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { impersonation, setAccessToken } from '@/lib/api';
import { useTenants, useCreateTenant, useUpdateTenant, useImpersonate, usePlans, useMe, type Plan, type TenantRow, type TenantProfile } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** Rótulo do plano nos seletores: gratuito aparece como tal (e com o prazo), não como "R$ 0,00". */
const planoLabel = (p: Plan, sufixo = '') =>
  p.isFree ? `${p.name} · Gratuito${p.durationDays ? ` (${p.durationDays} dias)` : ''}` : p.billingCycle === 'custom' ? `${p.name} · Personalizado` : `${p.name} · ${brl(Number(p.priceMonth))}${sufixo}`;
const STATUS: Record<string, [string, string]> = { trialing: ['Teste', 'bg-warn-soft text-warn-ink'], active: ['Ativa', 'bg-ok-soft text-ok'], past_due: ['Pendente', 'bg-warn-soft text-warn-ink'], suspended: ['Suspensa', 'bg-danger-soft text-danger-ink'], canceled: ['Cancelada', 'bg-field text-muted'] };

/** "AAAA-MM-DD" do vencimento no horário de Brasília (o input de data e a API falam assim). */
const diaSP = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Vencimento com o alerta: vencido em vermelho, até 7 dias em âmbar. */
function Vencimento({ sub }: { sub: NonNullable<TenantRow['subscription']> }) {
  // gratuito permanente não vence
  if (sub.plan.isFree && !sub.plan.durationDays) return <span className="text-[12px] text-faint">Não vence</span>;
  const fim = new Date(sub.currentPeriodEnd);
  const dias = Math.ceil((fim.getTime() - Date.now()) / 86_400_000);
  const [cls, sufixo] = dias < 0 ? ['text-danger-ink font-semibold', `vencido há ${-dias} dia${dias === -1 ? '' : 's'}`] : dias <= 7 ? ['text-warn-ink font-semibold', dias === 0 ? 'vence hoje' : `em ${dias} dia${dias === 1 ? '' : 's'}`] : ['text-ink', ''];
  return (
    <div className={cn('text-[12px] tnum', cls)} title={sub.gateway ? `Controlado pelo ${sub.gateway === 'stripe' ? 'Stripe' : 'Asaas'}` : 'Definido manualmente — edite em Editar'}>
      {fim.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
      {sufixo && <div className="text-[10.5px] font-normal">{sufixo}</div>}
    </div>
  );
}

/** CPF/CNPJ com pontuação para exibir (o banco guarda só dígitos). */
const fmtDoc = (d: string | null) => {
  if (!d) return '';
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
};

/** Gestão de clientes pelo dono: criar, plano/status, entrar como. */
export default function ClientesPage() {
  const me = useMe();
  const tenants = useTenants();
  const plans = usePlans();
  const update = useUpdateTenant();
  const impersonate = useImpersonate();
  const qc = useQueryClient();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editando, setEditando] = useState<TenantRow | null>(null);
  // empresas/unidades do cliente, direto daqui (sem "Entrar como")
  const [empresasDe, setEmpresasDe] = useState<TenantRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (me.data && me.data.role !== 'super_admin') return <PageShell><p className="text-sm text-muted">Área restrita ao dono do sistema.</p></PageShell>;

  async function enter(t: TenantRow) {
    setBusy(t.id);
    try {
      const r = await impersonate.mutateAsync(t.id);
      impersonation.set({ tenantId: t.id, name: t.name });
      setAccessToken(r.accessToken);
      qc.clear();
      router.push('/conversas');
    } catch (err) { toast.err(err); } finally { setBusy(null); }
  }
  async function patch(t: TenantRow, body: { name?: string; isActive?: boolean; planId?: string; subscriptionStatus?: string }) {
    setBusy(t.id);
    try { await update.mutateAsync({ ...body, id: t.id }); toast.ok('Cliente atualizado'); } catch (err) { toast.err(err); } finally { setBusy(null); }
  }

  return (
    <PageShell width="max-w-6xl">
      <PageHeader title="Clientes" subtitle="Todos os clientes do Atendo. Entre em qualquer um para ver o sistema como o admin dele." action={<Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>Novo cliente</Button>} />
      {tenants.isLoading && <SkeletonRows rows={3} />}
      {tenants.data && (
        <div className="rounded-2xl bg-panel border border-line overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-field text-left text-xs text-muted uppercase tracking-wide"><tr><th className="px-4 py-2.5">Cliente</th><th className="px-3 py-2.5">Admin</th><th className="px-3 py-2.5">Plano</th><th className="px-3 py-2.5">Assinatura</th><th className="px-3 py-2.5">Vencimento</th><th className="px-3 py-2.5 text-right">Números</th><th className="px-3 py-2.5 text-right">Usuários</th><th className="px-3 py-2.5 text-right">Conversas</th><th className="px-4 py-2.5"></th></tr></thead>
            <tbody className="divide-y divide-line">
              {tenants.data.map((t) => {
                const st = STATUS[t.subscription?.status ?? ''] ?? ['—', 'bg-field text-muted'];
                return (
                  <tr key={t.id} className={cn(!t.isActive && 'opacity-50')}>
                    <td className="px-4 py-2.5"><div className="font-medium text-ink flex items-center gap-2"><Building2 size={14} className="text-faint" />{t.name}</div><div className="text-[11px] text-faint">{t.slug} · desde {new Date(t.createdAt).toLocaleDateString('pt-BR')}</div>{(t.legalName || t.document) && <div className="text-[11px] text-muted truncate max-w-[16rem]">{[t.legalName, fmtDoc(t.document)].filter(Boolean).join(' · ')}</div>}</td>
                    <td className="px-3 py-2.5 text-muted">{t.users[0]?.email ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <select value={t.subscription?.plan.id ?? ''} disabled={busy === t.id} onChange={(e) => patch(t, { planId: e.target.value })} className="rounded-md border border-line bg-panel text-ink text-xs px-2 py-1">
                        {!t.subscription && <option value="">Sem plano</option>}
                        {plans.data?.map((p) => <option key={p.id} value={p.id}>{planoLabel(p)}</option>)}
                      </select>
                      {t.subscription?.plan.isFree && (
                        <div className="text-[10px] font-semibold text-ok mt-0.5">
                          Gratuito{t.subscription.plan.durationDays ? ` até ${new Date(t.subscription.currentPeriodEnd).toLocaleDateString('pt-BR')}` : ' permanente'}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <select value={t.subscription?.status ?? ''} disabled={busy === t.id || !t.subscription} onChange={(e) => patch(t, { subscriptionStatus: e.target.value })} className={cn('rounded-full text-xs px-2 py-0.5 border-0', st[1])}>
                        {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{t.subscription ? <Vencimento sub={t.subscription} /> : <span className="text-faint">—</span>}</td>
                    <td className="px-3 py-2.5 text-right tnum">{t._count.numbers}</td>
                    <td className="px-3 py-2.5 text-right tnum">{t._count.users}</td>
                    <td className="px-3 py-2.5 text-right tnum">{t._count.conversations}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditando(t)} title="Editar dados do cliente">Editar</Button>
                      <Button size="sm" variant="ghost" className="ml-1" icon={<Store size={13} />} onClick={() => setEmpresasDe(t)} title="Empresas e unidades do cliente">Empresas</Button>
                      <Button size="sm" variant="ghost" className="ml-1" icon={<Power size={13} />} onClick={() => patch(t, { isActive: !t.isActive })} loading={busy === t.id && update.isPending} title={t.isActive ? 'Desativar cliente' : 'Ativar cliente'}>{t.isActive ? 'Desativar' : 'Ativar'}</Button>
                      <Button size="sm" className="ml-1" icon={<Eye size={13} />} onClick={() => enter(t)} loading={busy === t.id && impersonate.isPending} loadingText="Entrando…">Entrar como</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <CreateTenantModal open={creating} onClose={() => setCreating(false)} />
      {editando && <EditTenantModal tenant={editando} onClose={() => setEditando(null)} />}
      <Modal open={!!empresasDe} onClose={() => setEmpresasDe(null)} title={`Empresas — ${empresasDe?.name ?? ''}`} width="max-w-2xl">
        {empresasDe && <CompaniesSection tenantId={empresasDe.id} />}
      </Modal>
    </PageShell>
  );
}

function CreateTenantModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const plans = usePlans();
  const create = useCreateTenant();
  const [f, setF] = useState({ name: '', slug: '', planId: '', adminName: '', adminEmail: '', adminPassword: '' });
  const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (
    <Modal open={open} onClose={onClose} title="Novo cliente">
      <form onSubmit={(e) => { e.preventDefault(); create.mutateAsync({ ...f, adminPassword: f.adminPassword || undefined, planId: f.planId || (plans.data?.[0]?.id ?? '') }).then(() => { toast.ok(f.adminPassword ? 'Cliente criado' : `Cliente criado — convite enviado para ${f.adminEmail}`); onClose(); }).catch(toast.err); }} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nome da empresa" hint="Como o cliente é conhecido. Aparece para ele no painel.">
            <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: slugify(e.target.value) })} required autoFocus placeholder="Farmácia Bem Estar" />
          </Field>
          <Field label="Identificador" hint="Gerado do nome; letras, números e hífen. Use para achar o cliente no suporte.">
            <input className={inputCls} value={f.slug} onChange={(e) => setF({ ...f, slug: slugify(e.target.value) })} required pattern="[a-z0-9-]{3,40}" placeholder="farmacia-bem-estar" />
          </Field>
        </div>
        <Field label="Plano inicial">
          <select className={inputCls} value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>{plans.data?.map((p) => <option key={p.id} value={p.id}>{planoLabel(p, '/mês')}</option>)}</select>
        </Field>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted pt-1">Administrador do cliente</div>
        <p className="text-[11px] text-muted -mt-2">É a pessoa que vai gerenciar a conta: cadastra os números, a equipe e as respostas. Ela entra com o e-mail abaixo.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nome"><input className={inputCls} value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} required placeholder="Maria Souza" /></Field>
          <Field label="E-mail" hint="É por aqui que ele entra no painel."><input type="email" className={inputCls} value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} required placeholder="maria@farmaciabemestar.com.br" /></Field>
        </div>
        <Field label="Senha inicial (opcional)" hint="Vazio = o admin recebe um convite por e-mail para criar a própria senha."><input type="text" className={inputCls} value={f.adminPassword} onChange={(e) => setF({ ...f, adminPassword: e.target.value })} minLength={8} /></Field>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={create.isPending} loadingText="Criando…">Criar cliente</Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Editar o cliente.
 *
 * Antes dava para mexer em plano e status direto na tabela, mas **o nome não tinha onde ser
 * corrigido** — e nome de empresa errado é o erro mais comum do cadastro, porque vem de um
 * cadastro feito às pressas na hora de fechar a venda.
 *
 * O identificador não entra: ele já foi usado em registro e suporte, e trocá-lo depois quebra
 * a referência de quem procura o cliente por ele.
 */
function EditTenantModal({ tenant, onClose }: { tenant: TenantRow; onClose: () => void }) {
  const plans = usePlans();
  const update = useUpdateTenant();
  const [f, setF] = useState({
    name: tenant.name,
    planId: tenant.subscription?.plan.id ?? '',
    subscriptionStatus: tenant.subscription?.status ?? 'active',
    isActive: tenant.isActive,
  });
  const vencimentoInicial = tenant.subscription ? diaSP(tenant.subscription.currentPeriodEnd) : '';
  const [vencimento, setVencimento] = useState(vencimentoInicial);
  const [perfil, setPerfil] = useState<Record<keyof TenantProfile, string>>(() => ({
    legalName: tenant.legalName ?? '', document: fmtDoc(tenant.document), contactName: tenant.contactName ?? '', billingEmail: tenant.billingEmail ?? '',
    phone: tenant.phone ?? '', zipCode: tenant.zipCode ?? '', street: tenant.street ?? '', addressNumber: tenant.addressNumber ?? '', complement: tenant.complement ?? '',
    district: tenant.district ?? '', city: tenant.city ?? '', state: tenant.state ?? '', notes: tenant.notes ?? '',
  }));
  const campo = (k: keyof TenantProfile) => ({ value: perfil[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setPerfil({ ...perfil, [k]: e.target.value }) });
  // com gateway, a data vem do Stripe/Asaas e o webhook sobrescreveria a edição
  const gateway = tenant.subscription?.gateway;
  return (
    <Modal open onClose={onClose} title={`Editar ${tenant.name}`} width="max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          update.mutateAsync({ id: tenant.id, ...f, planId: f.planId || undefined, profile: perfil, ...(vencimento && vencimento !== vencimentoInicial && { currentPeriodEnd: vencimento }) })
            .then(() => { toast.ok('Cliente atualizado'); onClose(); })
            .catch(toast.err);
        }}
        className="space-y-4"
      >
        <Field label="Nome da empresa"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></Field>
        <Field label="Identificador" hint="Não muda: já foi usado em cadastro e suporte."><input className={cn(inputCls, 'opacity-60')} value={tenant.slug} disabled /></Field>
        <div className="grid sm:grid-cols-2 gap-3 items-start">
          <Field label="Plano">
            <select className={inputCls} value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
              {!tenant.subscription && <option value="">Sem plano</option>}
              {plans.data?.map((p) => <option key={p.id} value={p.id}>{planoLabel(p, '/mês')}</option>)}
            </select>
          </Field>
          <Field
            label="Assinatura"
            hint={plans.data?.find((p) => p.id === f.planId)?.isFree && f.planId !== tenant.subscription?.plan.id
              ? 'Plano gratuito: a assinatura fica ativa, sem cartão. Se o cliente pagava pelo Stripe, essa cobrança é cancelada.'
              : 'Trocar de plano passa a valer o preço de tabela do novo.'}
          >
            <select className={inputCls} value={f.subscriptionStatus} onChange={(e) => setF({ ...f, subscriptionStatus: e.target.value })} disabled={!tenant.subscription}>
              {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
        {tenant.subscription && (
          <Field
            label="Vencimento do plano"
            hint={gateway
              ? `Controlado pelo ${gateway === 'stripe' ? 'Stripe' : 'Asaas'}: muda sozinho a cada cobrança paga.`
              : 'Até quando o plano vale. Vale o dia inteiro (horário de Brasília). Ao renovar, avance a data.'}
          >
            <input type="date" className={cn(inputCls, 'sm:w-56', gateway && 'opacity-60')} value={vencimento} onChange={(e) => setVencimento(e.target.value)} disabled={!!gateway} required={!gateway} />
          </Field>
        )}

        <div className="text-xs font-semibold uppercase tracking-wider text-muted pt-1">Dados cadastrais</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Razão social"><input className={inputCls} {...campo('legalName')} maxLength={150} /></Field>
          <Field label="CPF / CNPJ"><input className={inputCls} {...campo('document')} maxLength={20} inputMode="numeric" placeholder="00.000.000/0000-00" /></Field>
          <Field label="Responsável" hint="Quem responde pela conta."><input className={inputCls} {...campo('contactName')} maxLength={80} /></Field>
          <Field label="Telefone"><input className={inputCls} {...campo('phone')} maxLength={20} inputMode="tel" placeholder="(11) 99999-9999" /></Field>
          <Field label="E-mail financeiro" hint="Para cobrança e avisos. Não é o login."><input type="email" className={inputCls} {...campo('billingEmail')} maxLength={120} /></Field>
          <Field label="CEP"><input className={inputCls} {...campo('zipCode')} maxLength={10} inputMode="numeric" placeholder="00000-000" /></Field>
        </div>
        <div className="grid sm:grid-cols-[1fr_7rem] gap-3">
          <Field label="Endereço"><input className={inputCls} {...campo('street')} maxLength={150} placeholder="Rua, avenida…" /></Field>
          <Field label="Número"><input className={inputCls} {...campo('addressNumber')} maxLength={20} /></Field>
        </div>
        <div className="grid sm:grid-cols-[1fr_1fr_1fr_4.5rem] gap-3">
          <Field label="Complemento"><input className={inputCls} {...campo('complement')} maxLength={80} /></Field>
          <Field label="Bairro"><input className={inputCls} {...campo('district')} maxLength={80} /></Field>
          <Field label="Cidade"><input className={inputCls} {...campo('city')} maxLength={80} /></Field>
          <Field label="UF"><input className={cn(inputCls, 'uppercase')} {...campo('state')} maxLength={2} /></Field>
        </div>
        <Field label="Observações" hint="Só você vê."><textarea className={cn(inputCls, 'min-h-[4.5rem]')} {...campo('notes')} maxLength={2000} /></Field>

        <Field label="Acesso" hint="Desativado, ninguém da empresa consegue entrar — as conversas e o histórico ficam guardados.">
          <div className="flex gap-2">
            {[[true, 'Ativo'], [false, 'Desativado']].map(([v, l]) => (
              <button key={String(v)} type="button" onClick={() => setF({ ...f, isActive: v as boolean })} className={cn('rounded-lg border px-3 py-1.5 text-[13px]', f.isActive === v ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>{l as string}</button>
            ))}
          </div>
        </Field>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={update.isPending} loadingText="Salvando…">Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
