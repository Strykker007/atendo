'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Copy, ExternalLink, LogIn, Plus, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Empty, PageHeader, PageShell } from '@/components/ui/Page';
import { Field, Modal, inputCls } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { impersonation, setAccessToken } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  useImpersonate, usePartnerActivation, usePartnerClients, usePartnerCreateActivation, usePartnerCreateClient, usePartnerPlans, usePartnerTemplates, type PartnerClient,
} from '@/lib/hooks';
import { brl, cardCls, dataBR } from '@/components/partners/shared';

const STATUS: Record<string, [string, string]> = { trialing: ['Teste', 'bg-warn-soft text-warn-ink'], active: ['Ativo', 'bg-ok-soft text-ok'], past_due: ['Pagamento pendente', 'bg-warn-soft text-warn-ink'], suspended: ['Suspenso', 'bg-danger-soft text-danger-ink'], canceled: ['Cancelado', 'bg-field text-muted'] };
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** Portal do parceiro — clientes: cadastrar, entrar para configurar e gerar a ativação. */
export default function ParceiroClientes() {
  const clients = usePartnerClients();
  const impersonate = useImpersonate();
  const qc = useQueryClient();
  const router = useRouter();
  const [novo, setNovo] = useState(false);
  const [ativando, setAtivando] = useState<PartnerClient | null>(null);
  const [entrando, setEntrando] = useState<string | null>(null);

  async function entrar(c: PartnerClient) {
    setEntrando(c.id);
    try {
      const r = await impersonate.mutateAsync(c.id);
      impersonation.set({ tenantId: c.id, name: c.name });
      setAccessToken(r.accessToken);
      qc.clear();
      router.push('/configuracoes');
    } catch (err) { toast.err(err); } finally { setEntrando(null); }
  }

  return (
    <PageShell width="max-w-5xl">
      <PageHeader title="Meus clientes" subtitle="Cadastre, configure e ative. O cliente fica com você até o cancelamento." action={<Button icon={<Plus size={14} />} onClick={() => setNovo(true)}>Novo cliente</Button>} />
      {clients.isLoading ? <SkeletonRows /> : !clients.data?.length ? (
        <Empty icon={<Building2 size={28} />} title="Nenhum cliente ainda" text="Cadastre o primeiro: ele recebe o convite por e-mail e você configura o perfil por aqui." />
      ) : (
        <ul className="space-y-2">
          {clients.data.map((c) => {
            const [rotulo, cls] = c.awaitingActivation ? ['Aguardando ativação', 'bg-warn-soft text-warn-ink'] : STATUS[c.status ?? ''] ?? ['—', 'bg-field text-muted'];
            return (
              <li key={c.id} className={cn(cardCls, 'p-4 flex flex-wrap items-center gap-3', !c.isActive && 'opacity-60')}>
                <div className="flex-1 min-w-[14rem]">
                  <p className="font-medium text-ink flex items-center gap-2">{c.name}<span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', cls)}>{rotulo}</span></p>
                  <p className="text-[12px] text-faint">{c.plan ? `${c.plan.name}${c.plan.isFree ? ' · gratuito' : ` · ${brl(c.plan.monthly)}`}` : 'sem plano'} · desde {dataBR(c.since ?? c.createdAt)}{c.paidThisMonth > 0 && ` · pagou ${brl(c.paidThisMonth)} este mês`}</p>
                </div>
                {!c.plan?.isFree && <Button size="sm" variant="ghost" icon={<QrCode size={13} />} onClick={() => setAtivando(c)}>Ativação</Button>}
                <Button size="sm" icon={<LogIn size={13} />} loading={entrando === c.id} onClick={() => void entrar(c)}>Configurar</Button>
              </li>
            );
          })}
        </ul>
      )}
      <NovoCliente open={novo} onClose={() => setNovo(false)} />
      {ativando && <Ativacao c={ativando} onClose={() => setAtivando(null)} />}
    </PageShell>
  );
}

function NovoCliente({ open, onClose }: { open: boolean; onClose: () => void }) {
  const plans = usePartnerPlans();
  const templates = usePartnerTemplates();
  const create = usePartnerCreateClient();
  const vazio = { name: '', slug: '', planId: '', adminName: '', adminEmail: '', templateId: '' };
  const [f, setF] = useState(vazio);
  const plano = plans.data?.find((p) => p.id === f.planId);
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await create.mutateAsync({ name: f.name.trim(), slug: f.slug, planId: f.planId, adminName: f.adminName.trim(), adminEmail: f.adminEmail.trim(), templateId: f.templateId === 'none' ? null : f.templateId || undefined });
      toast.ok('Cliente cadastrado: o administrador recebeu o convite por e-mail');
      setF(vazio); onClose();
    } catch (err) { toast.err(err); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Novo cliente">
      <form onSubmit={salvar} className="space-y-3">
        <Field label="Nome da empresa"><input required autoFocus className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: slugify(e.target.value) })} placeholder="Farmácia Bem Estar" /></Field>
        <Field label="Identificador" hint="Letras minúsculas, números e hífen. Não muda depois."><input required pattern="[a-z0-9-]{3,40}" className={inputCls} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Plano">
            <select required className={inputCls} value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
              <option value="">Escolha…</option>
              {(plans.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.isFree ? `gratuito${p.durationDays ? ` (${p.durationDays} dias)` : ''}` : p.billingCycle === 'yearly' && p.priceYear ? `${brl(p.priceYear)}/ano` : `${brl(p.priceMonth)}/mês`}</option>)}
            </select>
          </Field>
          <Field label="Perfil (segmento)">
            <select className={inputCls} value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}>
              <option value="">Padrão</option>
              {(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (padrão)' : ''}</option>)}
              <option value="none">Nenhum (só o básico)</option>
            </select>
          </Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nome do administrador"><input required className={inputCls} value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} /></Field>
          <Field label="E-mail do administrador"><input required type="email" className={inputCls} value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} /></Field>
        </div>
        {plano && !plano.isFree && <p className="text-[12px] text-muted">Os valores são os do plano escolhido. Depois de cadastrar, gere a cobrança de ativação (instalação + 1ª mensalidade): o cliente configura tudo, mas só envia mensagens depois de pagar.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={create.isPending}>Cadastrar cliente</Button>
        </div>
      </form>
    </Modal>
  );
}

function Ativacao({ c, onClose }: { c: PartnerClient; onClose: () => void }) {
  const q = usePartnerActivation(c.id);
  const gerar = usePartnerCreateActivation();
  const [doc, setDoc] = useState('');
  const [venc, setVenc] = useState('');
  const a = q.data;
  const aberta = a?.charges.find((x) => x.status === 'pending');
  const total = (a?.setupFee ?? 0) + (a?.firstMonthValue ?? 0);
  return (
    <Modal open onClose={onClose} title={`Ativação — ${c.name}`}>
      {!a ? <SkeletonRows /> : (
        <div className="space-y-4 text-sm">
          {aberta ? (
            <div className="space-y-2">
              <p>Cobrança em aberto de <b>{brl(aberta.totalValue)}</b>, vence {aberta.dueDate.split('-').reverse().join('/')}.</p>
              <ul className="rounded-lg bg-field/60 divide-y divide-line">{aberta.items.map((i) => <li key={i.description} className="flex justify-between px-3 py-1.5"><span>{i.description}</span><span className="tnum">{brl(i.value)}</span></li>)}</ul>
              {aberta.invoiceUrl && (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => navigator.clipboard.writeText(aberta.invoiceUrl!).then(() => toast.ok('Link copiado')).catch(() => undefined)}>Copiar link do Pix</Button>
                  <a href={aberta.invoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-ink text-[13px]"><ExternalLink size={13} /> Abrir</a>
                </div>
              )}
              <p className="text-[12px] text-muted">O administrador do cliente também recebeu por e-mail e vê o Pix no painel. Pago, a conta ativa sozinha.</p>
            </div>
          ) : !a.awaitingActivation && a.charges.some((x) => x.status === 'paid') ? (
            <p>Ativação paga em {a.charges.find((x) => x.status === 'paid')?.paidAt ? dataBR(a.charges.find((x) => x.status === 'paid')!.paidAt) : '—'}. Conta ativa.</p>
          ) : (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); gerar.mutateAsync({ tenantId: c.id, document: doc || undefined, dueDate: venc || undefined }).then(() => toast.ok('Cobrança gerada e enviada ao cliente')).catch(toast.err); }}>
              <ul className="rounded-lg bg-field/60 divide-y divide-line">
                {a.setupFee > 0 && <li className="flex justify-between px-3 py-1.5"><span>Instalação e configuração</span><span className="tnum">{brl(a.setupFee)}</span></li>}
                {a.firstMonthValue > 0 && <li className="flex justify-between px-3 py-1.5"><span>1ª mensalidade — {a.planName}</span><span className="tnum">{brl(a.firstMonthValue)}</span></li>}
                <li className="flex justify-between px-3 py-1.5 font-semibold"><span>Total</span><span className="tnum">{brl(total)}</span></li>
              </ul>
              <p className="text-[12px] text-muted">Valores do plano e da tabela de instalação — não mudam por aqui.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="CPF/CNPJ do cliente" hint={a.document ? 'Já cadastrado.' : 'O Asaas exige para gerar o Pix.'}><input className={inputCls} value={doc} placeholder={a.document ?? ''} onChange={(e) => setDoc(e.target.value)} required={!a.document} /></Field>
                <Field label="Vencimento" hint="Vazio = hoje."><input type="date" className={inputCls} value={venc} onChange={(e) => setVenc(e.target.value)} /></Field>
              </div>
              {!a.asaasConfigured && <p className="text-[12px] text-warn-ink">Cobrança online indisponível no momento. Fale com a equipe.</p>}
              <div className="flex justify-end"><Button type="submit" loading={gerar.isPending} disabled={!a.asaasConfigured || total <= 0}>Gerar Pix de {brl(total)}</Button></div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
