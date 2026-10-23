'use client';
import { useEffect, useState } from 'react';
import { Building2, KeyRound, Link as LinkIcon, Plus, Search, Send, UserMinus, UserRound, X } from 'lucide-react';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { Field, Modal, inputCls } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import {
  useInviteOwner, useLinkOwner, useMe, useOwnerCandidates, useOwnerInviteLink, usePromoteOwner, useRemoveOwner, useSystemOwners, useTenants, useUnlinkOwner,
  type SystemOwner,
} from '@/lib/hooks';

const PAPEL: Record<SystemOwner['role'], string> = { super_admin: 'Sem empresa', tenant_admin: 'Administrador', manager: 'Gerente', agent: 'Atendente' };

/**
 * Donos do sistema (docs/donos-do-sistema.md): quem vê as telas de dono e conversa na equipe do
 * suporte. Cada dono pode ser vinculado a várias empresas (docs/multiempresa.md), com papel próprio
 * em cada uma; onde atua como dono, a empresa tem acesso amplo. Só dono abre esta tela (a API também bloqueia).
 */
export default function DonosPage() {
  const me = useMe();
  const owners = useSystemOwners();
  const remove = useRemoveOwner();
  const novoLink = useOwnerInviteLink();
  const unlink = useUnlinkOwner();
  const [adicionando, setAdicionando] = useState(false);
  const [vinculando, setVinculando] = useState<SystemOwner | null>(null);
  const [links, setLinks] = useState<{ name: string; url: string }[]>([]);
  const guardarLink = (name: string, url: string) => setLinks((xs) => [...xs.filter((x) => x.name !== name), { name, url }]);
  // a pessoa (login principal): numa empresa vinculada, `id` é a linha de lá
  const euId = me.data?.impersonatorId ?? me.data?.personId ?? me.data?.id;

  if (me.data && !me.data.systemOwner) return <PageShell><p className="text-sm text-muted">Área restrita ao dono do sistema.</p></PageShell>;

  async function desvincular(o: SystemOwner, m: SystemOwner['memberships'][number]) {
    if (!window.confirm(`Tirar ${o.name} de ${m.tenant?.name ?? 'esta empresa'}? As conversas e o histórico dele lá ficam; ele deixa de entrar nela.`)) return;
    try { await unlink.mutateAsync({ id: o.id, userId: m.id }); toast.ok('Vínculo desfeito'); } catch (err) { toast.err(err); }
  }

  async function tirar(o: SystemOwner) {
    const semEmpresa = !o.tenant;
    const ok = window.confirm(semEmpresa
      ? `${o.name} não tem empresa: tirar de dono desativa o acesso dele. Continuar?`
      : `${o.name} deixa de ser dono do sistema e continua nas empresas dele como membro comum. Continuar?`);
    if (!ok) return;
    try { await remove.mutateAsync(o.id); toast.ok(semEmpresa ? 'Acesso desativado' : 'Marcação de dono retirada'); } catch (err) { toast.err(err); }
  }

  return (
    <PageShell width="max-w-4xl">
      <PageHeader
        title="Donos do sistema"
        subtitle="Quem vê Financeiro, Clientes, Planos e Avisos, entra em qualquer cliente e conversa na Equipe do suporte."
        action={<Button icon={<Plus size={14} />} onClick={() => setAdicionando(true)}>Adicionar dono</Button>}
      />

      {links.length > 0 && (
        <div className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm space-y-2">
          <div className="flex items-center gap-2 font-medium text-accent-ink">
            <LinkIcon size={14} /> {links.length === 1 ? 'Link do convite' : `Links dos convites (${links.length})`} — vale 3 dias
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setLinks([])}>Fechar</Button>
          </div>
          {links.map((l) => (
            <div key={l.name} className="flex flex-wrap items-center gap-2">
              <span className="w-full sm:w-40 shrink-0 truncate font-medium text-ink" title={l.name}>{l.name}</span>
              <code className="flex-1 min-w-0 truncate rounded-lg bg-panel border border-line px-2.5 py-1.5 text-[11.5px] font-mono">{l.url}</code>
              <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(l.url).then(() => toast.ok(`Link de ${l.name} copiado`)).catch(() => undefined)}>Copiar</Button>
            </div>
          ))}
          <p className="text-[11.5px] text-muted">Cada link é de uma pessoa só. Ao abrir, ela cria a própria senha. Gerar outro link para a mesma pessoa faz o anterior parar de funcionar.</p>
        </div>
      )}

      {owners.isLoading ? <SkeletonRows /> : !owners.data?.length ? (
        <Empty icon={<KeyRound size={28} />} title="Nenhum dono" text="Adicione quem administra o sistema." />
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-panel">
          {owners.data.map((o) => (
            <li key={o.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', !o.isActive && 'opacity-60')}>
              <div className="w-9 h-9 rounded-full bg-accent-soft text-accent-ink grid place-items-center shrink-0"><KeyRound size={15} /></div>
              <div className="flex-1 min-w-[12rem]">
                <p className="truncate text-sm font-medium text-ink">{o.name}{o.id === euId && <span className="ml-1.5 text-[11px] text-muted">(você)</span>}</p>
                <p className="truncate text-[12px] text-faint">{o.email}</p>
              </div>
              <div className="text-[12px] text-muted min-w-[10rem]">
                {o.tenant
                  ? <span className="inline-flex items-center gap-1"><Building2 size={12} /> {o.tenant.name} · {PAPEL[o.role]}</span>
                  : <span>Sem empresa</span>}
                {!o.isActive ? <span className="block text-danger">Desativado</span> : !o.passwordSetAt && o.invitedAt && <span className="block text-warn-ink">Convite pendente</span>}
              </div>
              {o.memberships.length > 0 && (
                <div className="basis-full flex flex-wrap gap-1.5 pl-12">
                  {o.memberships.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-field px-2 py-0.5 text-[11.5px] text-muted">
                      <Building2 size={11} /> {m.tenant?.name} · {PAPEL[m.role]}{m.isSystemOwner && ' · dono'}
                      <button type="button" onClick={() => void desvincular(o, m)} disabled={unlink.isPending} className="ml-0.5 rounded hover:text-danger" title="Desfazer vínculo" aria-label={`Desfazer vínculo com ${m.tenant?.name}`}>
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1">
                {o.isActive && !o.passwordSetAt && o.invitedAt && (
                  <Button size="sm" variant="ghost" icon={<LinkIcon size={12} />} loading={novoLink.isPending && novoLink.variables === o.id}
                    onClick={() => novoLink.mutateAsync(o.id).then((r) => guardarLink(o.name, r.link)).catch(toast.err)}>Link</Button>
                )}
                {o.isActive && (
                  <Button size="sm" variant="ghost" icon={<Building2 size={12} />} onClick={() => setVinculando(o)}>Adicionar empresa</Button>
                )}
                {o.isActive && o.id !== euId && (
                  <button type="button" onClick={() => void tirar(o)} disabled={remove.isPending} className="p-1.5 rounded-md text-muted hover:text-danger hover:bg-field" title="Tirar de dono" aria-label="Tirar de dono">
                    <UserMinus size={15} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AdicionarModal open={adicionando} onClose={() => setAdicionando(false)} onLink={guardarLink} />
      <VincularModal owner={vinculando} onClose={() => setVinculando(null)} />
    </PageShell>
  );
}

/** Adicionar dono: marcar um usuário que já existe num cliente, ou convidar alguém novo (sem empresa). */
function AdicionarModal({ open, onClose, onLink }: { open: boolean; onClose: () => void; onLink: (name: string, url: string) => void }) {
  const [modo, setModo] = useState<'existente' | 'novo'>('existente');
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  useEffect(() => { const t = setTimeout(() => setTermo(busca.trim()), 300); return () => clearTimeout(t); }, [busca]);
  useEffect(() => { if (!open) { setBusca(''); setName(''); setEmail(''); setModo('existente'); } }, [open]);
  const candidatos = useOwnerCandidates(termo);
  const promote = usePromoteOwner();
  const invite = useInviteOwner();

  async function marcar(id: string, nome: string) {
    try { await promote.mutateAsync(id); toast.ok(`${nome} agora é dono do sistema`); onClose(); } catch (err) { toast.err(err); }
  }
  async function convidar() {
    try {
      const r = await invite.mutateAsync({ name: name.trim(), email: email.trim() });
      onLink(r.name, r.inviteLink);
      toast.ok(r.emailSent ? `Convite enviado para ${r.email}` : 'Dono criado — mande o link do convite');
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Adicionar dono do sistema">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-field p-1 text-[12px] font-semibold">
          {([['existente', 'Usuário existente'], ['novo', 'Pessoa nova']] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setModo(id)} className={cn('rounded-md py-1.5', modo === id ? 'bg-side text-white' : 'text-muted hover:text-ink')}>{label}</button>
          ))}
        </div>
        {modo === 'existente' ? (
          <>
            <p className="text-[12.5px] text-muted">A pessoa continua na empresa dela, com o mesmo papel, e ganha as telas de dono.</p>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <input autoFocus className={cn(inputCls, 'pl-8')} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou e-mail" aria-label="Buscar usuário" />
            </div>
            {termo.length >= 2 && (
              <ul className="divide-y divide-line rounded-lg border border-line max-h-64 overflow-y-auto">
                {!candidatos.data?.length ? (
                  <li className="px-3 py-2 text-[13px] text-faint">{candidatos.isFetching ? 'Buscando…' : 'Nenhum usuário encontrado.'}</li>
                ) : candidatos.data.map((c) => (
                  <li key={c.id}>
                    <button type="button" disabled={promote.isPending} onClick={() => void marcar(c.id, c.name)} className="group w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-field">
                      <UserRound size={15} className="text-faint shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm text-ink">{c.name}</p>
                        <p className="truncate text-[12px] text-faint">{c.email}{c.tenant ? ` · ${c.tenant.name}` : ''}</p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-faint group-hover:text-accent-ink"><Plus size={13} /> Tornar dono</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void convidar(); }}>
            <p className="text-[12.5px] text-muted">Cria um acesso de dono sem empresa. Depois, se quiser, vincule a uma empresa existente.</p>
            <Field label="Nome"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></Field>
            <Field label="E-mail" hint="A pessoa recebe um link para criar a própria senha."><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <div className="flex justify-end"><Button type="submit" icon={<Send size={13} />} loading={invite.isPending} disabled={name.trim().length < 2 || !email.trim()}>Convidar</Button></div>
          </form>
        )}
      </div>
    </Modal>
  );
}

/**
 * Vincular o dono a mais uma empresa (docs/multiempresa.md): ele vira membro de lá, com o papel
 * escolhido, e troca pelo seletor sem novo login. "Atua como dono" = acesso amplo nessa empresa.
 */
function VincularModal({ owner, onClose }: { owner: SystemOwner | null; onClose: () => void }) {
  const tenants = useTenants();
  const link = useLinkOwner();
  const [tenantId, setTenantId] = useState('');
  const [role, setRole] = useState<'tenant_admin' | 'manager' | 'agent'>('tenant_admin');
  const [dono, setDono] = useState(false);
  useEffect(() => { setTenantId(''); setRole('tenant_admin'); setDono(false); }, [owner?.id]);
  const nomeEmpresa = tenants.data?.find((t) => t.id === tenantId)?.name;
  // a empresa do login principal e as já vinculadas não aparecem de novo
  const ja = new Set([owner?.tenant?.id, ...(owner?.memberships ?? []).map((m) => m.tenant?.id)]);

  async function salvar() {
    if (!owner || !tenantId) return;
    try {
      await link.mutateAsync({ id: owner.id, tenantId, role, owner: dono });
      toast.ok(`${owner.name} agora faz parte de ${nomeEmpresa ?? 'a empresa'}`);
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open={!!owner} onClose={onClose} title={owner ? `Adicionar ${owner.name} a uma empresa` : ''}>
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">Vira membro da empresa com o papel escolhido: atende com o próprio nome, recebe transferências e aparece na equipe. Entra com o mesmo login e troca de empresa no seletor do menu (Ctrl+K).</p>
        <Field label="Empresa">
          <select className={inputCls} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            <option value="">Escolha…</option>
            {(tenants.data ?? []).filter((t) => !ja.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Papel na empresa">
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="tenant_admin">Administrador</option>
            <option value="manager">Gerente</option>
            <option value="agent">Atendente</option>
          </select>
        </Field>
        <label className="flex items-start gap-2 text-[13px] text-ink">
          <input type="checkbox" className="mt-0.5" checked={dono} onChange={(e) => setDono(e.target.checked)} />
          <span>
            Atua como dono nesta empresa
            <span className="block text-[12px] text-muted">A empresa ganha acesso amplo: todos os recursos, sem limites do plano. Deixe desmarcado onde for membro comum (ex.: síndico).</span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void salvar()} loading={link.isPending} disabled={!tenantId}>Adicionar</Button>
        </div>
      </div>
    </Modal>
  );
}
