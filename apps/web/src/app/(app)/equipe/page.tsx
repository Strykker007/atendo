'use client';
import { useEffect, useState } from 'react';
import { Plus, KeyRound, Power, Users, Pencil, UsersRound, X, ClipboardPaste } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { refresh } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useAgents, useCreateAgent, useCreateAgentsBulk, useUpdateAgent, useUsage, useMe, useResendInvite, useInviteLink, useProfiles, useCan, type Agent, type BulkAgentResult } from '@/lib/hooks';
import { AccessProfiles } from '@/components/settings/AccessProfiles';
import { NumberScopeButton } from '@/components/settings/NumberScope';
import { MailCheck, Send, Link as LinkIcon, History } from 'lucide-react';
import NextLink from 'next/link';
import { TYPING_SPEEDS, TYPING_SPEED_KEYS, type TypingSpeed } from '@atendo/shared';

export default function EquipePage() {
  const me = useMe();
  const canManageTeam = useCan('team.manage');
  // esconder na tela é conveniência; quem autoriza é a API, que checa a cada requisição
  const isAdmin = canManageTeam;
  const agents = useAgents();
  const profiles = useProfiles();
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [savingSpeedId, setSavingSpeedId] = useState<string | null>(null);
  const usage = useUsage();
  const create = useCreateAgent();
  const update = useUpdateAgent();
  const [creating, setCreating] = useState(false);
  const [creatingMany, setCreatingMany] = useState(false);
  const createMany = useCreateAgentsBulk();
  const [resetting, setResetting] = useState<Agent | null>(null);
  const [editing, setEditing] = useState<Agent | null>(null);
  const qc = useQueryClient();
  // nome: admin da conta edita de qualquer pessoa; gerente, só dos atendentes (a API repete a regra)
  const canRename = (a: Agent) => canManageTeam && (a.role === 'agent' || (a.role === 'manager' && me.data?.role !== 'manager') || (a.role === 'tenant_admin' && me.data?.role === 'tenant_admin'));
  // e-mail (login) e papel: admin edita atendentes e gerentes; gerente, só atendentes. Admin não muda o
  // próprio login por aqui — trocar encerra as sessões da pessoa
  const canEditAccess = (a: Agent) => canManageTeam && (a.role === 'agent' || (a.role === 'manager' && me.data?.role !== 'manager'));
  // e-mail de outro admin (ou o próprio): só o admin da conta — o papel continua fora do alcance
  // vínculo (docs/multiempresa.md): o login é o da empresa principal da pessoa — ninguém daqui troca
  const canEditEmail = (a: Agent) => !a.linked && (canEditAccess(a) || (canManageTeam && me.data?.role === 'tenant_admin' && a.role === 'tenant_admin'));
  async function saveEdit(a: Agent, b: { name?: string; email?: string; role?: 'agent' | 'manager' }) {
    try {
      await update.mutateAsync({ id: a.id, ...b });
      // o próprio nome também vai no token: renova para o painel já mostrar o novo
      if (a.id === me.data?.id) { await refresh(); qc.invalidateQueries({ queryKey: ['me'] }); }
      toast.ok(b.email || b.role ? 'Usuário atualizado — a pessoa precisa entrar de novo' : 'Usuário atualizado');
      setEditing(null);
    } catch (err) { toast.err(err); }
  }
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const resend = useResendInvite();
  const inviteLink = useInviteLink();
  const [linkId, setLinkId] = useState<string | null>(null);
  // links de convite gerados nesta tela, um por pessoa: convidar várias seguidas mostrava só o
  // último, sem dizer de quem era. Mesmo nome = link novo da mesma pessoa (o anterior deixa de valer)
  const [links, setLinks] = useState<{ url: string; name: string }[]>([]);
  const setLink = (l: { url: string; name: string } | null) => { if (l) setLinks((xs) => [...xs.filter((x) => x.name !== l.name), l]); };
  const [resendingId, setResendingId] = useState<string | null>(null);

  async function toggle(a: Agent) {
    setTogglingId(a.id);
    try {
      await update.mutateAsync({ id: a.id, isActive: !a.isActive });
      toast.ok(a.isActive ? 'Atendente desativado' : 'Atendente ativado');
    } catch (err) {
      toast.err(err);
    } finally {
      setTogglingId(null);
    }
  }

  const max = usage.data?.limits?.maxAgents;
  const count = usage.data?.used.agents ?? 0;
  const full = max != null && count >= max;
  const selectableProfiles = (profiles.data ?? []).filter((p) =>
    p.systemRole !== 'tenant_admin'
    && (me.data?.role === 'super_admin' || p.permissions.every((permission) => me.data?.permissions?.includes(permission))),
  );

  const ROLE_LABEL = { agent: 'Atendente', manager: 'Gerente', tenant_admin: 'Admin', super_admin: 'Dono' } as const;
  const selectCls = 'max-w-full rounded-md border border-line bg-panel text-ink text-xs px-2 py-1';

  const pessoa = (a: Agent) => (
    <div className="min-w-0">
      <p className="font-medium text-ink flex items-center gap-1.5">
        <span className="truncate">{a.name}</span>
        {a.id === me.data?.id && <span className="text-xs text-faint font-normal shrink-0">(você)</span>}
        {(canRename(a) || canEditEmail(a)) && !canEditAccess(a) && <button onClick={() => setEditing(a)} className="text-faint hover:text-ink p-0.5 shrink-0" title="Editar" aria-label={`Editar ${a.name}`}><Pencil size={12} /></button>}
      </p>
      {a.email && <p className="text-[12.5px] text-muted truncate" title={a.email}>{a.email}</p>}
      {a.linked && <p className="text-[11px] text-faint" title="Entra com o login de outra empresa e troca pelo seletor do menu">login de outra empresa</p>}
    </div>
  );

  const perfil = (a: Agent) => canManageTeam && a.role !== 'tenant_admin' && a.role !== 'super_admin' ? (
    <select
      value={a.profile?.id ?? ''}
      disabled={savingProfileId === a.id}
      onChange={async (e) => {
        setSavingProfileId(a.id);
        try { await update.mutateAsync({ id: a.id, profileId: e.target.value }); toast.ok('Perfil atualizado'); }
        catch (err) { toast.err(err); } finally { setSavingProfileId(null); }
      }}
      className={selectCls}
    >
      {/* sem perfil o acesso vem do papel — é o estado de quem existia antes dos perfis */}
      <option value="">Padrão do papel ({ROLE_LABEL[a.role]})</option>
      {profiles.data?.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
    </select>
  ) : (
    <span className={cn('text-xs rounded-full px-2 py-0.5 whitespace-nowrap', a.role === 'agent' ? 'bg-field text-muted' : a.role === 'manager' ? 'bg-warn-soft text-warn-ink' : 'bg-accent-soft text-accent-ink')}>{a.profile?.name ?? ROLE_LABEL[a.role]}</span>
  );

  const digitacao = (a: Agent) => canManageTeam ? (
    <select
      value={a.typingSpeed ?? 'normal'}
      disabled={savingSpeedId === a.id}
      title="Quanto tempo o contato vê &quot;digitando…&quot; antes da resposta rápida ou do texto colado chegar. Escolha o ritmo real desta pessoa."
      onChange={async (e) => {
        setSavingSpeedId(a.id);
        try { await update.mutateAsync({ id: a.id, typingSpeed: e.target.value as TypingSpeed }); toast.ok('Velocidade de digitação atualizada'); }
        catch (err) { toast.err(err); } finally { setSavingSpeedId(null); }
      }}
      className={selectCls}
    >
      {TYPING_SPEED_KEYS.map((k) => <option key={k} value={k}>{TYPING_SPEEDS[k].label}</option>)}
    </select>
  ) : (
    <span className="text-xs text-muted">{TYPING_SPEEDS[a.typingSpeed ?? 'normal']?.label}</span>
  );

  const quandoAcesso = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const ultimoAcesso = (a: Agent) => a.invitedAt && !a.passwordSetAt
    ? <span className="inline-flex items-center gap-1 text-xs rounded-full bg-warn-soft text-warn-ink px-2 py-0.5"><MailCheck size={12} /> convite pendente</span>
    : a.lastLoginAt
      ? canManageTeam
        ? <NextLink href={`/escalas/acessos?pessoa=${a.id}`} className="inline-flex items-center gap-1 hover:text-accent hover:underline" title="Ver os acessos no calendário"><History size={13} /> {quandoAcesso(a.lastLoginAt)}</NextLink>
        : quandoAcesso(a.lastLoginAt)
      : 'nunca';

  /** `compacto` (tabela): só ícones, com dica no mouse; no cartão do celular os botões do convite levam texto. */
  const acoes = (a: Agent, compacto = false) => (
    <>
      {isAdmin && a.invitedAt && !a.passwordSetAt && (
        <>
          <Button
            size={compacto ? 'icon' : 'sm'}
            variant="ghost"
            className={cn(compacto && 'border-0 bg-transparent text-faint hover:text-ink')}
            icon={<LinkIcon size={compacto ? 15 : 12} />}
            loading={linkId === a.id}
            title="Copiar link do convite — para mandar pelo WhatsApp, não depende de e-mail"
            aria-label={`Copiar link do convite de ${a.name}`}
            onClick={async () => {
              setLinkId(a.id);
              try {
                const r = await inviteLink.mutateAsync(a.id);
                setLink({ url: r.link, name: a.name });
                try { await navigator.clipboard.writeText(r.link); toast.ok('Link copiado — mande para o atendente'); }
                catch { toast.ok('Link gerado abaixo'); }
              } catch (err) { toast.err(err); } finally { setLinkId(null); }
            }}
          >
            {!compacto && 'Copiar link'}
          </Button>
          <Button size={compacto ? 'icon' : 'sm'} variant="ghost" className={cn(compacto && 'border-0 bg-transparent text-faint hover:text-ink')} icon={<Send size={compacto ? 15 : 12} />} title="Reenviar o convite por e-mail" aria-label={`Reenviar o convite de ${a.name} por e-mail`} loading={resendingId === a.id} onClick={async () => { setResendingId(a.id); try { const r = await resend.mutateAsync(a.id); if (r.emailSent) toast.ok(`Convite reenviado para ${a.email}`); else { setLink({ url: r.inviteLink, name: a.name }); toast.ok('E-mail não configurado — use o link do convite'); } } catch (err) { toast.err(err); } finally { setResendingId(null); } }}>{!compacto && 'Reenviar'}</Button>
        </>
      )}
      {isAdmin && (a.role === 'agent' || (a.role === 'manager' && me.data?.role !== 'manager')) && (
        <>
          <Button size="icon" variant="ghost" className="border-0 bg-transparent text-faint hover:text-ink" title="Editar" aria-label={`Editar ${a.name}`} onClick={() => setEditing(a)} icon={<Pencil size={15} />} />
          {!a.linked && <Button size="icon" variant="ghost" className="border-0 bg-transparent text-faint hover:text-ink" title="Redefinir senha" aria-label={`Redefinir senha de ${a.name}`} onClick={() => setResetting(a)} icon={<KeyRound size={15} />} />}
          <Button size="icon" variant="ghost" className={cn('border-0 bg-transparent', a.isActive ? 'text-faint hover:text-danger' : 'text-accent')} onClick={() => toggle(a)} loading={togglingId === a.id} title={a.isActive ? 'Desativar' : 'Ativar'} aria-label={a.isActive ? `Desativar ${a.name}` : `Ativar ${a.name}`} icon={<Power size={15} />} />
        </>
      )}
    </>
  );

  return (
    <PageShell width="max-w-6xl">
      <PageHeader
        title="Equipe"
        subtitle={<>Escolha o perfil de acesso de cada pessoa — ele define exatamente o que ela pode fazer. {max !== undefined && <>Plano <b>{usage.data?.plan}</b>: {max === null ? `${count} membros (ilimitado)` : `${count}/${max} membros`}.</>}</>}
        action={isAdmin && (
          <div className="flex flex-wrap gap-2">
            <NextLink href="/escalas/acessos" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-field"><History size={16} /> Registro de acessos</NextLink>
            <Button variant="ghost" onClick={() => setCreatingMany(true)} disabled={full} title={full ? 'Limite do plano atingido' : 'Colar uma lista de nomes e e-mails'} icon={<UsersRound size={16} />}>Adicionar várias</Button>
            <Button onClick={() => setCreating(true)} disabled={full} title={full ? 'Limite do plano atingido' : undefined} icon={<Plus size={16} />}>Novo membro</Button>
          </div>
        )}
      />

      {full && <p className="rounded-lg bg-warn-soft border border-warn/30 px-4 py-2 text-sm text-warn-ink">Limite de atendentes do plano atingido. Desative alguém ou faça upgrade em <b>Plano e uso</b>.</p>}

      {agents.isLoading && <SkeletonRows rows={3} />}
      {agents.data?.length === 0 && <Empty icon={<Users size={36} />} title="Nenhum usuário" text="Adicione atendentes para dividir o atendimento." />}

      {!!agents.data?.length && (
        <>
          {/* tela larga: tabela; celular: cartões — nada escondido atrás de rolagem lateral */}
          <div className="hidden md:block rounded-2xl bg-panel border border-line overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-field text-left text-xs text-muted uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5">Pessoa</th>
                  <th className="px-4 py-2.5">Perfil de acesso</th>
                  <th className="px-4 py-2.5">Números</th>
                  <th className="px-4 py-2.5 hidden lg:table-cell" title="Velocidade do &quot;digitando…&quot; que o contato vê nas mensagens que a pessoa não digitou (resposta rápida, texto colado, encaminhada, agendada). Máximo de 10 segundos por mensagem.">Digitação</th>
                  <th className="px-4 py-2.5">Último acesso</th>
                  <th className="px-4 py-2.5"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {agents.data.map((a) => (
                  <tr key={a.id} className={cn('align-middle', !a.isActive && 'opacity-50')}>
                    <td className="px-4 py-3 min-w-48">{pessoa(a)}</td>
                    <td className="px-4 py-3">{perfil(a)}</td>
                    <td className="px-4 py-3"><NumberScopeButton agent={a} /></td>
                    <td className="px-4 py-3 hidden lg:table-cell">{digitacao(a)}</td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">{ultimoAcesso(a)}</td>
                    <td className="px-4 py-3"><div className="flex items-center justify-end gap-0.5 whitespace-nowrap">{acoes(a, true)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="md:hidden space-y-2">
            {agents.data.map((a) => (
              <li key={a.id} className={cn('rounded-2xl bg-panel border border-line p-4 space-y-3', !a.isActive && 'opacity-50')}>
                {pessoa(a)}
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
                  <dt className="text-xs text-muted">Perfil</dt><dd className="min-w-0">{perfil(a)}</dd>
                  <dt className="text-xs text-muted">Números</dt><dd className="min-w-0"><NumberScopeButton agent={a} /></dd>
                  <dt className="text-xs text-muted">Digitação</dt><dd className="min-w-0">{digitacao(a)}</dd>
                  <dt className="text-xs text-muted">Último acesso</dt><dd className="min-w-0 text-muted">{ultimoAcesso(a)}</dd>
                </dl>
                <div className="flex flex-wrap items-center gap-1 border-t border-line pt-3 empty:hidden">{acoes(a)}</div>
              </li>
            ))}
          </ul>
        </>
      )}

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
          <p className="text-[11.5px] text-muted">Cada link é de uma pessoa só: mande para quem está ao lado dele. Ao abrir, a pessoa cria a própria senha. Gerar outro link para a mesma pessoa faz o anterior parar de funcionar.</p>
        </div>
      )}

      <AccessProfiles />

      <CreateAgentModal open={creating} onClose={() => setCreating(false)} profiles={selectableProfiles} onSubmit={(b) => create.mutateAsync(b).then((r) => { if (r.invited) { setLink(r.inviteLink ? { url: r.inviteLink, name: b.name } : null); toast.ok(r.emailSent ? `Convite enviado para ${b.email}` : 'Membro criado — mande o link do convite'); } else toast.ok('Membro criado'); setCreating(false); }).catch(toast.err)} pending={create.isPending} />
      <BulkAgentsModal
        open={creatingMany}
        onClose={() => setCreatingMany(false)}
        profiles={selectableProfiles}
        room={max == null ? null : Math.max(0, max - count)}
        pending={createMany.isPending}
        onSubmit={(b) => createMany.mutateAsync(b).then((r) => {
          // os links entram na mesma lista do convite individual, um por pessoa
          setLinks((xs) => [...xs.filter((x) => !r.results.some((y) => y.ok && y.name === x.name)), ...r.results.filter((y) => y.ok && y.inviteLink).map((y) => ({ url: y.inviteLink!, name: y.name }))]);
          const falhas = r.results.length - r.created;
          if (r.created) toast.ok(`${r.created} convite${r.created === 1 ? '' : 's'} criado${r.created === 1 ? '' : 's'}${falhas ? ` · ${falhas} com erro` : ''}`);
          return r.results;
        }).catch((err) => { toast.err(err); return null; })}
      />
      <EditAgentModal agent={editing} onClose={() => setEditing(null)} canEditAccess={!!editing && canEditAccess(editing)} canEditEmail={!!editing && canEditEmail(editing)} isSelf={editing?.id === me.data?.id} canEditRole={me.data?.role !== 'manager'} onSubmit={(b) => editing && saveEdit(editing, b)} pending={update.isPending} />
      <ResetPasswordModal agent={resetting} onClose={() => setResetting(null)} onSubmit={(password) => resetting && update.mutateAsync({ id: resetting.id, password }).then(() => { toast.ok('Senha redefinida'); setResetting(null); }).catch(toast.err)} pending={update.isPending} />
    </PageShell>
  );
}

function CreateAgentModal({ open, onClose, onSubmit, pending, profiles }: { open: boolean; onClose: () => void; onSubmit: (b: { name: string; email: string; password?: string; profileId?: string }) => void; pending: boolean; profiles: { id: string; name: string; systemRole?: 'tenant_admin' | 'manager' | 'agent' | null }[] }) {
  const defaultProfileId = profiles.find((p) => p.systemRole === 'agent')?.id ?? profiles[0]?.id ?? '';
  const [f, setF] = useState({ name: '', email: '', password: '', profileId: '' });
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (open) setF({ name: '', email: '', password: '', profileId: defaultProfileId });
  }, [open, defaultProfileId]);
  return (
    <Modal open={open} onClose={onClose} title="Novo membro da equipe" width="max-w-sm">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...f, profileId: f.profileId || undefined, password: manual ? f.password : undefined }); }} className="space-y-4">
        <Field label="Perfil de acesso" hint="O perfil define o que esta pessoa pode fazer.">
          <select className={inputCls} value={f.profileId} onChange={(e) => setF({ ...f, profileId: e.target.value })} required={profiles.length > 0}>
            {!profiles.length && <option value="">Acesso padrão</option>}
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Nome"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></Field>
        <Field label="E-mail"><input type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> Definir a senha agora (em vez de enviar convite por e-mail)</label>
        {manual ? (
          <Field label="Senha inicial" hint="Mínimo 8 caracteres. Envie por um canal seguro."><input type="text" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={8} required /></Field>
        ) : (
          <p className="text-xs text-muted rounded-lg bg-field px-3 py-2">A pessoa recebe um e-mail com um link (válido por 3 dias) para criar a própria senha.</p>
        )}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button><Button type="submit" loading={pending} loadingText={manual ? 'Criando…' : 'Enviando…'}>{manual ? 'Criar' : 'Enviar convite'}</Button></div>
      </form>
    </Modal>
  );
}

type Perfil = { id: string; name: string; systemRole?: 'tenant_admin' | 'manager' | 'agent' | null };
/**
 * `tocou`: campos de onde a pessoa já saiu — o aviso de cada campo só aparece depois disso
 * (digitando, não; e sair do nome não acusa o e-mail que ela ainda vai digitar).
 */
type Linha = { key: number; name: string; email: string; profileId: string; erro?: string; tocou?: { name?: boolean; email?: boolean } };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const semAcento = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
let proximaChave = 0;

/**
 * Texto colado (planilha: tab; ou `;`/`,`) → linhas. Em cada linha o e-mail é achado pelo `@`, o
 * perfil pelo nome (sem acento/maiúscula) e o resto é o nome. Sem perfil reconhecido, usa `padrao`.
 */
function colarLinhas(texto: string, perfis: Perfil[], padrao: string): Linha[] {
  return texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((linha) => {
    const partes = linha.split(/[\t;,]/).map((x) => x.trim()).filter(Boolean);
    const email = partes.find((x) => EMAIL_RE.test(x)) ?? '';
    const perfil = perfis.find((p) => partes.some((x) => semAcento(x) === semAcento(p.name)));
    const name = partes.filter((x) => x !== email && (!perfil || semAcento(x) !== semAcento(perfil.name))).join(' ').slice(0, 80);
    return { key: ++proximaChave, name, email, profileId: perfil?.id ?? padrao };
  });
}

const faltaNome = (l: Linha) => !l.name.trim();
const emailRuim = (l: Linha) => !EMAIL_RE.test(l.email.trim());
const problemaDa = (l: Linha) => (faltaNome(l) ? 'falta o nome' : emailRuim(l) ? 'e-mail inválido' : null);

/**
 * Várias pessoas de uma vez, cada uma com o seu perfil, por convite. Linha a linha (como um
 * formulário) ou colando de uma planilha — Nome, e-mail e, se quiser, o perfil pelo nome.
 */
function BulkAgentsModal({ open, onClose, onSubmit, pending, profiles, room }: { open: boolean; onClose: () => void; onSubmit: (b: { people: { name: string; email: string; profileId?: string }[] }) => Promise<BulkAgentResult[] | null>; pending: boolean; profiles: Perfil[]; room: number | null }) {
  const padrao = profiles.find((p) => p.systemRole === 'agent')?.id ?? profiles[0]?.id ?? '';
  const nova = (profileId = padrao): Linha => ({ key: ++proximaChave, name: '', email: '', profileId });
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [colando, setColando] = useState(false);
  const [colado, setColado] = useState('');
  // clicou em Convidar com linha errada: a partir daí todas as linhas mostram o que falta
  const [tentou, setTentou] = useState(false);
  useEffect(() => {
    if (open) { setLinhas([nova(), nova(), nova()]); setColando(false); setColado(''); setTentou(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, padrao]);
  const tocar = (key: number, campo: 'name' | 'email') => setLinhas((xs) => xs.map((x) => (x.key === key ? { ...x, tocou: { ...x.tocou, [campo]: true } } : x)));
  const mudar = (key: number, p: Partial<Linha>) => setLinhas((xs) => xs.map((x) => (x.key === key ? { ...x, ...p, erro: undefined } : x)));
  // linha em branco não conta (sobra das 3 iniciais); preenchida pela metade é erro
  const preenchidas = linhas.filter((l) => l.name.trim() || l.email.trim());
  const comProblema = preenchidas.filter((l) => problemaDa(l));
  const validas = preenchidas.filter((l) => !problemaDa(l));
  const passaDoPlano = room !== null && validas.length > room;
  function aplicarColagem() {
    const novas = colarLinhas(colado, profiles, linhas[linhas.length - 1]?.profileId || padrao);
    // substitui as linhas vazias, mantém o que já foi digitado
    // colado já vem completo: o que estiver errado aparece na hora
    setLinhas((xs) => [...xs.filter((x) => x.name.trim() || x.email.trim()), ...novas.map((n) => ({ ...n, tocou: { name: true, email: true } }))]);
    setColado('');
    setColando(false);
  }
  async function enviar() {
    if (comProblema.length) { setTentou(true); return; }
    const r = await onSubmit({ people: validas.map((l) => ({ name: l.name.trim(), email: l.email.trim(), profileId: l.profileId || undefined })) });
    if (!r) return;
    const falhas = r.filter((x) => !x.ok);
    if (!falhas.length) return onClose();
    // ficam só as que não entraram, com o motivo na própria linha
    setLinhas(falhas.map((f) => ({ key: ++proximaChave, name: f.name, email: f.email, profileId: validas.find((v) => v.email.trim() === f.email)?.profileId ?? padrao, erro: f.error })));
  }
  return (
    <Modal open={open} onClose={onClose} title="Adicionar várias pessoas" width="max-w-3xl">
      <div className="space-y-3">
        {/* Grade em vez de tabela: no celular cada pessoa vira um bloco (nome, e-mail e perfil um
            embaixo do outro); da largura sm em diante, uma linha. Os campos usam a altura padrão do
            inputCls — forçar h-8 com o py-2 dele cortava o texto do seletor ("Gerente" comido). */}
        <div className="rounded-xl border border-line divide-y divide-line">
          <div className="hidden sm:grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1.3fr)_minmax(9rem,11rem)_2rem] gap-2 px-3 py-2 bg-field rounded-t-xl text-xs text-muted">
            <span>#</span><span>Nome</span><span>E-mail</span><span>Perfil de acesso</span><span />
          </div>
          {linhas.map((l, i) => {
            // linha vazia nunca acusa; preenchida, cada campo acusa depois de sair dele (ou ao tentar enviar)
            const usada = !!(l.name.trim() || l.email.trim());
            const avisoNome = usada && (tentou || l.tocou?.name) && faltaNome(l) ? 'falta o nome' : null;
            const avisoEmail = usada && (tentou || l.tocou?.email) && emailRuim(l) ? (l.email.trim() ? 'e-mail inválido' : 'falta o e-mail') : null;
            return (
              <div key={l.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_2rem] sm:grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1.3fr)_minmax(9rem,11rem)_2rem] gap-2 px-3 py-2 items-start">
                <span className="pt-2 text-faint tnum text-sm">{i + 1}</span>
                <>
                  <div className="col-start-2 sm:col-start-auto"><input className={inputCls} value={l.name} onChange={(e) => mudar(l.key, { name: e.target.value })} onBlur={() => tocar(l.key, 'name')} placeholder="Nome" maxLength={80} aria-label={`Nome da pessoa ${i + 1}`} aria-invalid={!!avisoNome} />
                    {avisoNome && <p className="text-[11px] text-danger-ink mt-0.5">{avisoNome}</p>}
                  </div>
                  <div className="col-start-2 sm:col-start-auto">
                    <input type="email" className={inputCls} value={l.email} onChange={(e) => mudar(l.key, { email: e.target.value })} onBlur={() => tocar(l.key, 'email')} placeholder="email@empresa.com.br" aria-label={`E-mail da pessoa ${i + 1}`} aria-invalid={!!avisoEmail} />
                    {(l.erro || avisoEmail) && <p className="text-[11px] text-danger-ink mt-0.5">{l.erro ?? avisoEmail}</p>}
                  </div>
                  <div className="col-start-2 sm:col-start-auto">
                    <select className={inputCls} value={l.profileId} onChange={(e) => mudar(l.key, { profileId: e.target.value })} aria-label={`Perfil de acesso da pessoa ${i + 1}`}>
                      {!profiles.length && <option value="">Acesso padrão</option>}
                      {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </>
                <button type="button" onClick={() => setLinhas((xs) => (xs.length > 1 ? xs.filter((x) => x.key !== l.key) : [nova()]))} className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto mt-1 p-1.5 rounded-md text-faint hover:text-danger-ink hover:bg-field" title="Remover linha" aria-label={`Remover a pessoa ${i + 1}`}><X size={14} /></button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* a nova linha herda o perfil da última: quem cadastra 5 atendentes seguidos não escolhe 5 vezes */}
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} disabled={linhas.length >= 50} onClick={() => setLinhas((xs) => [...xs, nova(xs[xs.length - 1]?.profileId)])}>Adicionar linha</Button>
          <Button size="sm" variant="ghost" icon={<ClipboardPaste size={14} />} onClick={() => setColando((v) => !v)}>Colar de uma planilha</Button>
          <span className="ml-auto text-[12px] text-muted"><b className="text-ink tnum">{validas.length}</b> para convidar (máx. 50){room !== null && <> · o plano comporta mais <b className="text-ink tnum">{room}</b></>}</span>
        </div>
        {colando && (
          <div className="rounded-xl bg-field p-3 space-y-2">
            <p className="text-[12px] text-muted">Uma pessoa por linha: <b>nome</b>, <b>e-mail</b> e, se quiser, o <b>perfil</b> com o mesmo nome que aparece aqui (ex.: Gerente). Separe por tab (colar da planilha), ponto e vírgula ou vírgula. Sem perfil, entra no da última linha.</p>
            <textarea className={cn(inputCls, 'h-28 font-mono text-[12.5px]')} value={colado} onChange={(e) => setColado(e.target.value)} placeholder={'Maria Souza; maria@loja.com.br; Atendente\nJoão Lima; joao@loja.com.br; Gerente'} autoFocus />
            <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setColando(false)}>Cancelar</Button><Button size="sm" onClick={aplicarColagem} disabled={!colado.trim()}>Pôr na lista</Button></div>
          </div>
        )}
        {passaDoPlano && <p className="text-[12.5px] text-warn-ink">A lista passa do limite do plano: tire {validas.length - room!} pessoa{validas.length - room! === 1 ? '' : 's'} ou faça upgrade em Plano e uso.</p>}
        <p className="text-xs text-muted rounded-lg bg-field px-3 py-2">Cada pessoa recebe um e-mail com o link (válido por 3 dias) para criar a própria senha. Os links também aparecem aqui na Equipe para você mandar pelo WhatsApp.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Fechar</Button><Button onClick={enviar} disabled={!validas.length || validas.length > 50 || passaDoPlano} loading={pending} loadingText="Convidando…">Convidar {validas.length || ''}</Button></div>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ agent, onClose, onSubmit, pending }: { agent: Agent | null; onClose: () => void; onSubmit: (p: string) => void; pending: boolean }) {
  const [p, setP] = useState('');
  return (
    <Modal open={!!agent} onClose={onClose} title={`Redefinir senha · ${agent?.name ?? ''}`} width="max-w-sm">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(p); setP(''); }} className="space-y-4">
        <Field label="Nova senha" hint="As sessões ativas deste atendente serão encerradas."><input type="text" className={inputCls} value={p} onChange={(e) => setP(e.target.value)} minLength={8} required autoFocus /></Field>
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button><Button type="submit" loading={pending} loadingText="Redefinindo…">Redefinir</Button></div>
      </form>
    </Modal>
  );
}

function EditAgentModal({ agent, onClose, onSubmit, pending, canEditAccess, canEditEmail, isSelf, canEditRole }: { agent: Agent | null; onClose: () => void; onSubmit: (b: { name?: string; email?: string; role?: 'agent' | 'manager' }) => void; pending: boolean; canEditAccess: boolean; canEditEmail: boolean; isSelf: boolean; canEditRole: boolean }) {
  const [f, setF] = useState<{ name: string; email: string; role: 'agent' | 'manager' }>({ name: '', email: '', role: 'agent' });
  const [forId, setForId] = useState<string | null>(null);
  // preenche com os dados atuais ao abrir para outra pessoa
  if (agent && forId !== agent.id) { setForId(agent.id); setF({ name: agent.name, email: agent.email, role: agent.role === 'manager' ? 'manager' : 'agent' }); }
  if (!agent && forId) setForId(null);
  // manda só o que mudou: e-mail/papel encerram as sessões da pessoa
  const changes = agent ? {
    ...(f.name.trim() !== agent.name && { name: f.name.trim() }),
    ...(canEditEmail && f.email.trim().toLowerCase() !== agent.email.toLowerCase() && { email: f.email.trim().toLowerCase() }),
    ...(canEditAccess && canEditRole && f.role !== agent.role && { role: f.role }),
  } : {};
  const dirty = Object.keys(changes).length > 0;
  return (
    <Modal open={!!agent} onClose={onClose} title={`Editar · ${agent?.name ?? ''}`} width="max-w-sm">
      <form onSubmit={(e) => { e.preventDefault(); if (f.name.trim() && dirty) onSubmit(changes); }} className="space-y-4">
        <Field label="Nome de exibição"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} required autoFocus /></Field>
        {canEditEmail ? (
          <Field label="E-mail" hint={isSelf ? 'É o seu login. Ao trocar, você sai e entra de novo com o novo e-mail.' : 'É o login. Ao trocar, a pessoa precisa entrar de novo.'}><input type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={120} required /></Field>
        ) : (
          <p className="text-xs text-muted">{agent?.email}</p>
        )}
        {canEditAccess && canEditRole && (
          <Field label="Papel">
            <div className="grid grid-cols-2 gap-2">
              {(['agent', 'manager'] as const).map((r) => (
                <button type="button" key={r} onClick={() => setF({ ...f, role: r })} className={cn('rounded-lg border px-3 py-2 text-left', f.role === r ? 'border-accent bg-accent-soft' : 'border-line hover:bg-field')}>
                  <div className="text-sm font-semibold text-ink">{r === 'agent' ? 'Atendente' : 'Gerente'}</div>
                  <div className="text-[11px] text-muted">{r === 'agent' ? 'Atende as próprias conversas' : 'Vê todas, transfere, orienta por nota interna'}</div>
                </button>
              ))}
            </div>
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button><Button type="submit" loading={pending} loadingText="Salvando…" disabled={!f.name.trim() || !dirty}>Salvar</Button></div>
      </form>
    </Modal>
  );
}
