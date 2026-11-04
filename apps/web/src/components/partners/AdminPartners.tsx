'use client';
import { useEffect, useState } from 'react';
import { Building2, Handshake, KeyRound, Link as LinkIcon, Plus, Search, UserPlus, X } from 'lucide-react';
import { PARTNER_STATUS_LABEL, PAYOUT_PIX_KEY_TYPES, PAYOUT_PIX_KEY_TYPE_LABEL, type PartnerStatus, type PartnerTierRule, type PayoutPixKeyType } from '@atendo/shared';
import { Button } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Page';
import { Field, Modal, inputCls } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import {
  useAddPartnerLogin, useCreatePartner, usePartner, usePartnerLoginLink, usePartners, useSetPartnerLoginActive, useSetPartnerPix,
  useSetPartnerTiers, useSetTenantPartner, useUnassignedTenants, useUpdatePartner, type PartnerDetail,
} from '@/lib/hooks';
import { CodeDialog, RankCard, RankCompact, TiersEditor, brl, cardCls, dataBR, dataHoraBR, pct, tiersText } from './shared';

const STATUS_CLS: Record<PartnerStatus, string> = { active: 'bg-ok-soft text-ok', suspended: 'bg-warn-soft text-warn-ink', ended: 'bg-field text-muted' };

/** Aba Parceiros: lista, cadastro e a ficha de cada um. */
export function AdminPartners() {
  const list = usePartners();
  const [novo, setNovo] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button icon={<Plus size={14} />} onClick={() => setNovo(true)}>Novo parceiro</Button></div>
      {list.isLoading ? <SkeletonRows /> : !list.data?.length ? (
        <Empty icon={<Handshake size={28} />} title="Nenhum parceiro" text="Cadastre o primeiro VogoPartner: ele cadastra os clientes dele e recebe a comissão aqui." />
      ) : (
        <div className={cn(cardCls, 'overflow-x-auto')}>
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-left text-[12px] text-muted border-b border-line">
              <tr><th className="px-4 py-2.5 font-medium">Parceiro</th><th className="px-3 font-medium">Clientes</th><th className="px-3 font-medium">Patente</th><th className="px-3 font-medium text-right">Mês (previsão)</th><th className="px-3 font-medium text-right">Instalações (semana)</th><th className="px-4 font-medium text-right">A pagar</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data.map((p) => (
                <tr key={p.id} onClick={() => setAberto(p.id)} className="cursor-pointer hover:bg-field/60">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-ink">{p.name}</p>
                    <p className="text-[11.5px] text-faint flex items-center gap-1.5">
                      <span className={cn('rounded-full px-1.5', STATUS_CLS[p.status])}>{PARTNER_STATUS_LABEL[p.status]}</span>
                      {!p.pixKey && <span className="text-warn-ink">sem chave Pix</span>}
                    </p>
                  </td>
                  <td className="px-3 tnum">{p.activeClients} ativos <span className="text-faint">/ {p.clients}</span></td>
                  <td className="px-3 py-2">
                    <RankCompact tiers={p.tiers} activeClients={p.activeClients} />
                    {p.customTiers && <span className="text-[11px] text-accent-ink">faixas próprias</span>}
                  </td>
                  <td className="px-3 text-right tnum">{brl(p.monthEstimate)}</td>
                  <td className="px-3 text-right tnum">{brl(p.weekSetup)}</td>
                  <td className="px-4 text-right tnum">{brl(p.openPayouts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NovoParceiro open={novo} onClose={() => setNovo(false)} onCreated={(id) => { setNovo(false); setAberto(id); }} />
      {aberto && <FichaParceiro id={aberto} onClose={() => setAberto(null)} />}
    </div>
  );
}

function NovoParceiro({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const create = useCreatePartner();
  const [f, setF] = useState({ name: '', document: '', email: '', phone: '', loginName: '', loginEmail: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const login = f.loginEmail.trim() ? { name: f.loginName.trim() || f.name.trim(), email: f.loginEmail.trim() } : undefined;
      const p = await create.mutateAsync({ name: f.name, document: f.document || null, email: f.email || null, phone: f.phone || null, ...(login && { login }) });
      toast.ok(login ? 'Parceiro cadastrado e convite enviado' : 'Parceiro cadastrado');
      setF({ name: '', document: '', email: '', phone: '', loginName: '', loginEmail: '' });
      onCreated(p.id);
    } catch (err) { toast.err(err); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Novo parceiro">
      <form onSubmit={salvar} className="space-y-3">
        <Field label="Nome"><input required className={inputCls} value={f.name} onChange={set('name')} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="CPF/CNPJ" hint="Para a nota e o Pix."><input className={inputCls} value={f.document} onChange={set('document')} /></Field>
          <Field label="Telefone"><input className={inputCls} value={f.phone} onChange={set('phone')} /></Field>
        </div>
        <Field label="E-mail de contato"><input type="email" className={inputCls} value={f.email} onChange={set('email')} /></Field>
        <div className="rounded-xl bg-field/60 p-3 space-y-3">
          <p className="text-[12.5px] text-muted">Acesso ao portal (opcional — dá para criar depois). Recebe um convite por e-mail para criar a senha.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nome no login"><input className={inputCls} value={f.loginName} onChange={set('loginName')} placeholder={f.name} /></Field>
            <Field label="E-mail de login"><input type="email" className={inputCls} value={f.loginEmail} onChange={set('loginEmail')} /></Field>
          </div>
        </div>
        <p className="text-[11.5px] text-faint">A chave Pix e as faixas próprias são definidas na ficha, depois de salvar. A chave exige o código do autenticador.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={create.isPending}>Cadastrar</Button>
        </div>
      </form>
    </Modal>
  );
}

function FichaParceiro({ id, onClose }: { id: string; onClose: () => void }) {
  const q = usePartner(id);
  const p = q.data;
  return (
    <Modal open onClose={onClose} title={p ? p.name : 'Parceiro'} width="max-w-3xl">
      {q.isError ? <p className="text-sm text-danger-ink">Não foi possível abrir o parceiro: {(q.error as Error)?.message ?? 'erro desconhecido'}.</p> : !p ? <SkeletonRows /> : (
        <div className="space-y-6">
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl bg-field/60 p-3"><p className="text-[12px] text-muted">Clientes ativos</p><p className="text-lg font-semibold tnum">{p.current.activeClients}</p></div>
            <div className="rounded-xl bg-field/60 p-3"><p className="text-[12px] text-muted">Mensalidade hoje</p><p className="text-lg font-semibold">{pct(p.current.rate)}</p><p className="text-[11px] text-faint">{p.current.custom ? 'faixas próprias' : 'faixas do programa'}</p></div>
            <div className="rounded-xl bg-field/60 p-3"><p className="text-[12px] text-muted">Instalação</p><p className="text-lg font-semibold">{pct(p.effectiveSetupRate)}</p><p className="text-[11px] text-faint">{p.setupRate === null ? 'padrão do programa' : 'próprio'}</p></div>
          </div>
          <RankCard tiers={p.current.tiers} activeClients={p.current.activeClients} />
          <Dados p={p} />
          <ChavePix p={p} />
          <Faixas p={p} />
          <Logins p={p} />
          <Clientes p={p} />
          <section>
            <h3 className="text-sm font-semibold mb-2">Histórico</h3>
            {!p.events.length ? <p className="text-sm text-faint">Nada ainda.</p> : (
              <ul className="text-[12.5px] divide-y divide-line rounded-xl border border-line max-h-56 overflow-y-auto">
                {p.events.map((e) => <li key={e.id} className="px-3 py-1.5 flex gap-2"><span className="text-faint tnum shrink-0">{dataHoraBR(e.createdAt)}</span><span className="text-ink">{EVENT_LABEL[e.action] ?? e.action}</span><span className="text-muted truncate">{e.actorName ?? 'sistema'}</span></li>)}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

export const EVENT_LABEL: Record<string, string> = {
  'partner.created': 'Parceiro cadastrado', 'partner.updated': 'Cadastro alterado', 'partner.pix_key': 'Chave Pix definida/trocada', 'partner.tiers': 'Faixas alteradas',
  'partner.login_created': 'Login criado', 'partner.login_enabled': 'Login reativado', 'partner.login_disabled': 'Login desativado', 'partner.tenant': 'Cliente vinculado/desvinculado',
  'partner.client_created': 'Parceiro cadastrou cliente', 'partner.activation': 'Parceiro gerou cobrança de ativação',
  'payout.apurado': 'Ciclo apurado', 'payout.first_approval': '1ª autorização', 'payout.approved': 'Pagamento autorizado', 'payout.sent': 'Pix enviado ao Asaas',
  'payout.failed': 'Pagamento falhou', 'payout.retry': 'Nova tentativa', 'payout.paid_manual': 'Baixa manual', 'payout.canceled': 'Apuração desfeita',
  'transfer.validated': 'Asaas: saque validado', 'transfer.refused': 'Asaas: saque RECUSADO', 'totp.enabled': 'Autenticador ativado', 'totp.disabled': 'Autenticador desativado', 'settings.updated': 'Configuração alterada',
};

function Dados({ p }: { p: PartnerDetail }) {
  const update = useUpdatePartner();
  const [f, setF] = useState({ name: p.name, document: p.document ?? '', email: p.email ?? '', phone: p.phone ?? '', notes: p.notes ?? '', setupRate: p.setupRate === null ? '' : String(p.setupRate), status: p.status });
  useEffect(() => { setF({ name: p.name, document: p.document ?? '', email: p.email ?? '', phone: p.phone ?? '', notes: p.notes ?? '', setupRate: p.setupRate === null ? '' : String(p.setupRate), status: p.status }); }, [p]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (f.status !== p.status && f.status !== 'active' && !window.confirm(f.status === 'ended' ? 'Encerrar o parceiro: ele perde o acesso e para de gerar comissão. O que já foi apurado continua a pagar. Continuar?' : 'Suspender: ele perde o acesso e os pagamentos ficam retidos até reativar. Continuar?')) return;
    try {
      await update.mutateAsync({ id: p.id, name: f.name, document: f.document || null, email: f.email || null, phone: f.phone || null, notes: f.notes || null, setupRate: f.setupRate === '' ? null : Number(f.setupRate.replace(',', '.')), status: f.status });
      toast.ok('Parceiro atualizado');
    } catch (err) { toast.err(err); }
  }
  return (
    <form onSubmit={salvar} className="space-y-3">
      <h3 className="text-sm font-semibold">Cadastro</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Nome"><input required className={inputCls} value={f.name} onChange={set('name')} /></Field>
        <Field label="Situação">
          <select className={inputCls} value={f.status} onChange={set('status')}>
            {(['active', 'suspended', 'ended'] as PartnerStatus[]).map((s) => <option key={s} value={s}>{PARTNER_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="CPF/CNPJ"><input className={inputCls} value={f.document} onChange={set('document')} /></Field>
        <Field label="Telefone"><input className={inputCls} value={f.phone} onChange={set('phone')} /></Field>
        <Field label="E-mail de contato"><input type="email" className={inputCls} value={f.email} onChange={set('email')} /></Field>
        <Field label="% da instalação só dele" hint="Vazio = padrão do programa."><input inputMode="decimal" className={inputCls} value={f.setupRate} onChange={set('setupRate')} placeholder="padrão" /></Field>
      </div>
      <Field label="Observações"><textarea rows={2} className={inputCls} value={f.notes} onChange={set('notes')} /></Field>
      <div className="flex justify-end"><Button type="submit" size="sm" loading={update.isPending}>Salvar cadastro</Button></div>
    </form>
  );
}

function ChavePix({ p }: { p: PartnerDetail }) {
  const setPix = useSetPartnerPix();
  const [f, setF] = useState<{ pixKey: string; pixKeyType: PayoutPixKeyType }>({ pixKey: '', pixKeyType: 'CNPJ' });
  const [pedindo, setPedindo] = useState(false);
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-1.5"><KeyRound size={14} /> Chave Pix</h3>
      <p className="text-sm">{p.pixKey ? <><span className="font-mono">{p.pixKey}</span> <span className="text-muted">({PAYOUT_PIX_KEY_TYPE_LABEL[p.pixKeyType ?? 'EVP']})</span>{p.pixKeyChangedAt && <span className="text-faint"> · trocada em {dataHoraBR(p.pixKeyChangedAt)}</span>}</> : <span className="text-warn-ink">Sem chave: os pagamentos dele não saem.</span>}</p>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (f.pixKey.trim()) setPedindo(true); }}>
        <select className={cn(inputCls, 'w-40')} value={f.pixKeyType} onChange={(e) => setF((x) => ({ ...x, pixKeyType: e.target.value as PayoutPixKeyType }))}>
          {PAYOUT_PIX_KEY_TYPES.map((t) => <option key={t} value={t}>{PAYOUT_PIX_KEY_TYPE_LABEL[t]}</option>)}
        </select>
        <input className={cn(inputCls, 'flex-1 min-w-[12rem]')} placeholder="Nova chave" value={f.pixKey} onChange={(e) => setF((x) => ({ ...x, pixKey: e.target.value }))} />
        <Button type="submit" size="sm" variant="ghost">{p.pixKey ? 'Trocar chave' : 'Cadastrar chave'}</Button>
      </form>
      <p className="text-[11.5px] text-faint">Trocar a chave pede o código do autenticador, avisa todos os donos por e-mail e segura os pagamentos dele durante a carência.</p>
      <CodeDialog open={pedindo} title="Confirmar chave Pix" busy={setPix.isPending} onClose={() => setPedindo(false)}
        onConfirm={async (code) => {
          try { await setPix.mutateAsync({ id: p.id, ...f, code }); toast.ok('Chave Pix salva'); setPedindo(false); setF((x) => ({ ...x, pixKey: '' })); } catch (err) { toast.err(err); }
        }}>
        <p className="text-sm">Nova chave de <b>{p.name}</b>: <span className="font-mono">{f.pixKey}</span> ({PAYOUT_PIX_KEY_TYPE_LABEL[f.pixKeyType]}). Confira com o parceiro antes de confirmar.</p>
      </CodeDialog>
    </section>
  );
}

function Faixas({ p }: { p: PartnerDetail }) {
  const save = useSetPartnerTiers();
  const [proprias, setProprias] = useState(p.current.custom);
  const [tiers, setTiers] = useState<PartnerTierRule[]>(p.current.custom ? p.tiers.map(({ minClients, rate }) => ({ minClients, rate })) : p.current.tiers);
  async function salvar() {
    try { await save.mutateAsync({ id: p.id, tiers: proprias ? tiers : [] }); toast.ok(proprias ? 'Faixas do parceiro salvas' : 'Voltou às faixas padrão'); } catch (err) { toast.err(err); }
  }
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Comissão sobre a mensalidade</h3>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={proprias} onChange={(e) => setProprias(e.target.checked)} /> Faixas próprias para este parceiro</label>
      {proprias ? <TiersEditor value={tiers} onChange={setTiers} /> : <p className="text-sm text-muted">Padrão do programa: {tiersText(p.current.custom ? [] : p.current.tiers)}</p>}
      <div className="flex justify-end"><Button size="sm" loading={save.isPending} onClick={() => void salvar()}>Salvar faixas</Button></div>
    </section>
  );
}

function Logins({ p }: { p: PartnerDetail }) {
  const add = useAddPartnerLogin();
  const link = usePartnerLoginLink();
  const toggle = useSetPartnerLoginActive();
  const [f, setF] = useState({ name: '', email: '' });
  const [url, setUrl] = useState<string | null>(null);
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Acessos ao portal</h3>
      {p.users.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line text-sm">
          {p.users.map((u) => (
            <li key={u.id} className={cn('flex flex-wrap items-center gap-2 px-3 py-2', !u.isActive && 'opacity-60')}>
              <div className="flex-1 min-w-[10rem]"><p className="font-medium">{u.name}</p><p className="text-[11.5px] text-faint">{u.email} · {u.passwordSetAt ? `último acesso ${dataBR(u.lastLoginAt)}` : 'convite pendente'}</p></div>
              {!u.passwordSetAt && u.isActive && <Button size="sm" variant="ghost" icon={<LinkIcon size={12} />} onClick={() => link.mutateAsync({ id: p.id, userId: u.id }).then((r) => setUrl(r.link)).catch(toast.err)}>Link</Button>}
              <Button size="sm" variant="ghost" onClick={() => toggle.mutateAsync({ id: p.id, userId: u.id, isActive: !u.isActive }).catch(toast.err)}>{u.isActive ? 'Desativar' : 'Reativar'}</Button>
            </li>
          ))}
        </ul>
      )}
      {url && (
        <div className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[12px]">
          <code className="flex-1 truncate font-mono">{url}</code>
          <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(url).then(() => toast.ok('Link copiado')).catch(() => undefined)}>Copiar</Button>
          <button type="button" onClick={() => setUrl(null)} aria-label="Fechar"><X size={13} /></button>
        </div>
      )}
      <form className="flex flex-wrap gap-2" onSubmit={async (e) => {
        e.preventDefault();
        try { const r = await add.mutateAsync({ id: p.id, ...f }); setF({ name: '', email: '' }); if (!r.emailSent) setUrl(r.inviteLink); toast.ok(r.emailSent ? 'Convite enviado por e-mail' : 'Login criado: copie o link do convite'); } catch (err) { toast.err(err); }
      }}>
        <input required className={cn(inputCls, 'flex-1 min-w-[9rem]')} placeholder="Nome" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} />
        <input required type="email" className={cn(inputCls, 'flex-1 min-w-[12rem]')} placeholder="E-mail de login" value={f.email} onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))} />
        <Button type="submit" size="sm" variant="ghost" icon={<UserPlus size={13} />} loading={add.isPending}>Criar acesso</Button>
      </form>
    </section>
  );
}

function Clientes({ p }: { p: PartnerDetail }) {
  const setTenant = useSetTenantPartner();
  const [busca, setBusca] = useState('');
  const sem = useUnassignedTenants(busca);
  const [vinculando, setVinculando] = useState(false);
  async function vincular(tenantId: string, partnerId: string | null, nome: string) {
    if (!partnerId && !window.confirm(`Tirar ${nome} de ${p.name}? Os próximos pagamentos dele deixam de gerar comissão.`)) return;
    try { await setTenant.mutateAsync({ tenantId, partnerId }); toast.ok(partnerId ? 'Cliente vinculado' : 'Cliente desvinculado'); } catch (err) { toast.err(err); }
  }
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><Building2 size={14} /> Clientes ({p.tenants.length})</h3>
        <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setVinculando((v) => !v)}>Vincular cliente existente</Button>
      </div>
      {vinculando && (
        <div className="rounded-xl border border-line p-3 space-y-2">
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className={cn(inputCls, 'pl-8')} placeholder="Buscar cliente sem parceiro" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
          <ul className="max-h-40 overflow-y-auto text-sm divide-y divide-line">
            {(sem.data ?? []).map((t) => (
              <li key={t.id} className="flex items-center justify-between py-1.5"><span className={cn(!t.isActive && 'text-faint')}>{t.name}</span><Button size="sm" variant="ghost" onClick={() => void vincular(t.id, p.id, t.name)}>Vincular</Button></li>
            ))}
          </ul>
          <p className="text-[11.5px] text-faint">A comissão conta dos pagamentos feitos a partir do vínculo.</p>
        </div>
      )}
      {!p.tenants.length ? <p className="text-sm text-faint">Nenhum cliente ainda.</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line text-sm max-h-72 overflow-y-auto">
          {p.tenants.map((t) => (
            <li key={t.id} className={cn('flex flex-wrap items-center gap-2 px-3 py-2', !t.isActive && 'opacity-60')}>
              <div className="flex-1 min-w-[10rem]">
                <p className="font-medium">{t.name}</p>
                <p className="text-[11.5px] text-faint">{t.subscription?.plan.name ?? 'sem plano'}{t.subscription?.priceMonth != null && ` · ${brl(t.subscription.priceMonth)}`} · {t.subscription?.awaitingActivation ? 'aguardando ativação' : t.subscription?.status ?? '—'} · desde {dataBR(t.partnerAttributedAt)}</p>
              </div>
              <button type="button" onClick={() => void vincular(t.id, null, t.name)} className="p-1.5 rounded-md text-muted hover:text-danger hover:bg-field" title="Desvincular" aria-label={`Desvincular ${t.name}`}><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
