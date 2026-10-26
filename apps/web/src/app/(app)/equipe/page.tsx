'use client';
import { useEffect, useState } from 'react';
import { Plus, KeyRound, Power, Users, Pencil, UsersRound } from 'lucide-react';
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
import { MailCheck, Send, Link as LinkIcon } from 'lucide-react';
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

  return (
    <PageShell width="max-w-4xl">
      <PageHeader
        title="Equipe"
        subtitle={<>Escolha o perfil de acesso de cada pessoa — ele define exatamente o que ela pode fazer. {max !== undefined && <>Plano <b>{usage.data?.plan}</b>: {max === null ? `${count} membros (ilimitado)` : `${count}/${max} membros`}.</>}</>}
        action={isAdmin && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setCreatingMany(true)} disabled={full} title={full ? 'Limite do plano atingido' : 'Colar uma lista de nomes e e-mails'} icon={<UsersRound size={16} />}>Adicionar várias</Button>
            <Button onClick={() => setCreating(true)} disabled={full} title={full ? 'Limite do plano atingido' : undefined} icon={<Plus size={16} />}>Novo membro</Button>
          </div>
        )}
      />

      {full && <p className="rounded-lg bg-warn-soft border border-warn/30 px-4 py-2 text-sm text-warn-ink">Limite de atendentes do plano atingido. Desative alguém ou faça upgrade em <b>Plano e uso</b>.</p>}

      {agents.isLoading && <SkeletonRows rows={3} />}
      {agents.data?.length === 0 && <Empty icon={<Users size={36} />} title="Nenhum usuário" text="Adicione atendentes para dividir o atendimento." />}

      {!!agents.data?.length && (
        <div className="rounded-2xl bg-panel border border-line overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-field text-left text-xs text-muted uppercase tracking-wide">
              <tr><th className="px-5 py-2.5">Nome</th><th className="px-5 py-2.5 hidden sm:table-cell">E-mail</th><th className="px-5 py-2.5">Perfil de acesso</th><th className="px-5 py-2.5">Números</th><th className="px-5 py-2.5 hidden lg:table-cell" title="Velocidade do &quot;digitando…&quot; que o contato vê nas mensagens que a pessoa não digitou (resposta rápida, texto colado, encaminhada, agendada). Máximo de 10 segundos por mensagem.">Digitação</th><th className="px-5 py-2.5 hidden md:table-cell">Último acesso</th><th className="px-5 py-2.5"></th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {agents.data.map((a) => (
                <tr key={a.id} className={cn(!a.isActive && 'opacity-50')}>
                  <td className="px-5 py-3 font-medium">
                    {a.name}{a.id === me.data?.id && <span className="ml-2 text-xs text-faint">(você)</span>}
                    {(canRename(a) || canEditEmail(a)) && !canEditAccess(a) && <button onClick={() => setEditing(a)} className="ml-1.5 align-middle text-faint hover:text-ink p-0.5" title="Editar" aria-label={`Editar ${a.name}`}><Pencil size={12} /></button>}
                  </td>
                  <td className="px-5 py-3 text-muted hidden sm:table-cell">{a.email}{a.linked && <span className="block text-[11px] text-faint" title="Entra com o login de outra empresa e troca pelo seletor do menu">login de outra empresa</span>}</td>
                  <td className="px-5 py-3">
                    {canManageTeam && a.role !== 'tenant_admin' && a.role !== 'super_admin' ? (
                      <select
                        value={a.profile?.id ?? ''}
                        disabled={savingProfileId === a.id}
                        onChange={async (e) => {
                          setSavingProfileId(a.id);
                          try { await update.mutateAsync({ id: a.id, profileId: e.target.value }); toast.ok('Perfil atualizado'); }
                          catch (err) { toast.err(err); } finally { setSavingProfileId(null); }
                        }}
                        className="rounded-md border border-line bg-panel text-ink text-xs px-2 py-1"
                      >
                        {/* sem perfil o acesso vem do papel — é o estado de quem existia antes dos perfis */}
                        <option value="">Padrão do papel ({{ agent: 'Atendente', manager: 'Gerente', tenant_admin: 'Admin', super_admin: 'Dono' }[a.role]})</option>
                        {profiles.data?.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                      </select>
                    ) : (
                      <span className={cn('text-xs rounded-full px-2 py-0.5', a.role === 'agent' ? 'bg-field text-muted' : a.role === 'manager' ? 'bg-warn-soft text-warn-ink' : 'bg-accent-soft text-accent-ink')}>{a.profile?.name ?? { agent: 'Atendente', manager: 'Gerente', tenant_admin: 'Admin', super_admin: 'Dono' }[a.role]}</span>
                    )}
                  </td>
                  <td className="px-5 py-3"><NumberScopeButton agent={a} /></td>
                  <td className="px-5 py-3 hidden lg:table-cell">
                    {canManageTeam ? (
                      <select
                        value={a.typingSpeed ?? 'normal'}
                        disabled={savingSpeedId === a.id}
                        title="Quanto tempo o contato vê &quot;digitando…&quot; antes da resposta rápida ou do texto colado chegar. Escolha o ritmo real desta pessoa."
                        onChange={async (e) => {
                          setSavingSpeedId(a.id);
                          try { await update.mutateAsync({ id: a.id, typingSpeed: e.target.value as TypingSpeed }); toast.ok('Velocidade de digitação atualizada'); }
                          catch (err) { toast.err(err); } finally { setSavingSpeedId(null); }
                        }}
                        className="rounded-md border border-line bg-panel text-ink text-xs px-2 py-1"
                      >
                        {TYPING_SPEED_KEYS.map((k) => <option key={k} value={k}>{TYPING_SPEEDS[k].label}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-muted">{TYPING_SPEEDS[a.typingSpeed ?? 'normal']?.label}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-muted hidden md:table-cell">
                    {a.invitedAt && !a.passwordSetAt ? <span className="inline-flex items-center gap-1 text-xs rounded-full bg-warn-soft text-warn-ink px-2 py-0.5"><MailCheck size={12} /> convite pendente</span> : a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString('pt-BR') : 'nunca'}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {isAdmin && a.invitedAt && !a.passwordSetAt && (
                      <>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<LinkIcon size={12} />}
                        loading={linkId === a.id}
                        title="Gera um link para você mandar pelo WhatsApp — não depende de e-mail"
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
                        Copiar link do convite
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Send size={12} />} loading={resendingId === a.id} onClick={async () => { setResendingId(a.id); try { const r = await resend.mutateAsync(a.id); if (r.emailSent) toast.ok(`Convite reenviado para ${a.email}`); else { setLink({ url: r.inviteLink, name: a.name }); toast.ok('E-mail não configurado — use o link do convite'); } } catch (err) { toast.err(err); } finally { setResendingId(null); } }}>Reenviar por e-mail</Button>
                      </>
                    )}
                    {isAdmin && (a.role === 'agent' || (a.role === 'manager' && me.data?.role !== 'manager')) && (
                      <>
                        <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={() => setEditing(a)}>Editar</Button>
                        {!a.linked && <button onClick={() => setResetting(a)} className="text-faint hover:text-ink p-1" title="Redefinir senha"><KeyRound size={15} /></button>}
                        <Button size="icon" variant="ghost" className={cn('border-0 bg-transparent', a.isActive ? 'text-faint hover:text-danger' : 'text-accent')} onClick={() => toggle(a)} loading={togglingId === a.id} title={a.isActive ? 'Desativar' : 'Ativar'} icon={<Power size={15} />} />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

/**
 * Várias pessoas de uma vez: uma por linha, "Nome; e-mail" (também aceita tab — colar do Excel —,
 * vírgula ou o e-mail primeiro). Todas no mesmo perfil, por convite.
 */
function parsePessoas(texto: string) {
  return texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((linha) => {
    const partes = linha.split(/[\t;,]/).map((x) => x.trim()).filter(Boolean);
    const email = partes.find((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) ?? '';
    const name = partes.filter((x) => x !== email).join(' ').slice(0, 80);
    return { linha, name, email, erro: !email ? 'sem e-mail válido' : !name ? 'sem nome' : null };
  });
}

function BulkAgentsModal({ open, onClose, onSubmit, pending, profiles, room }: { open: boolean; onClose: () => void; onSubmit: (b: { profileId?: string; people: { name: string; email: string }[] }) => Promise<BulkAgentResult[] | null>; pending: boolean; profiles: { id: string; name: string; systemRole?: 'tenant_admin' | 'manager' | 'agent' | null }[]; room: number | null }) {
  const defaultProfileId = profiles.find((p) => p.systemRole === 'agent')?.id ?? profiles[0]?.id ?? '';
  const [profileId, setProfileId] = useState('');
  const [texto, setTexto] = useState('');
  const [resultado, setResultado] = useState<BulkAgentResult[] | null>(null);
  useEffect(() => {
    if (open) { setProfileId(defaultProfileId); setTexto(''); setResultado(null); }
  }, [open, defaultProfileId]);
  const pessoas = parsePessoas(texto);
  const validas = pessoas.filter((p) => !p.erro);
  const passaDoPlano = room !== null && validas.length > room;
  async function enviar() {
    const r = await onSubmit({ profileId: profileId || undefined, people: validas.map(({ name, email }) => ({ name, email })) });
    if (!r) return;
    // só os que deram erro continuam na caixa, para corrigir e mandar de novo
    const falhas = r.filter((x) => !x.ok);
    if (!falhas.length) return onClose();
    setResultado(r);
    setTexto(falhas.map((x) => `${x.name}; ${x.email}`).join('\n'));
  }
  return (
    <Modal open={open} onClose={onClose} title="Adicionar várias pessoas" width="max-w-lg">
      <div className="space-y-4">
        <Field label="Perfil de acesso" hint="Todas as pessoas desta lista entram neste perfil. Dá para trocar depois, uma a uma.">
          <select className={inputCls} value={profileId} onChange={(e) => setProfileId(e.target.value)} required={profiles.length > 0}>
            {!profiles.length && <option value="">Acesso padrão</option>}
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Pessoas" hint="Uma por linha: nome e e-mail separados por ponto e vírgula, vírgula ou tab. Dá para colar direto de uma planilha.">
          <textarea className={cn(inputCls, 'h-40 font-mono text-[12.5px]')} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'Maria Souza; maria@loja.com.br\nJoão Lima; joao@loja.com.br'} autoFocus />
        </Field>
        {pessoas.length > 0 && (
          <div className="text-[12.5px] space-y-1">
            <p className="text-muted"><b className="text-ink tnum">{validas.length}</b> pessoa{validas.length === 1 ? '' : 's'} para convidar (máx. 50 por vez){room !== null && <> · o plano ainda comporta <b className="text-ink tnum">{room}</b></>}</p>
            {pessoas.filter((p) => p.erro).map((p) => <p key={p.linha} className="text-danger-ink truncate">“{p.linha}” — {p.erro}</p>)}
            {passaDoPlano && <p className="text-warn-ink">A lista passa do limite do plano: tire {validas.length - room!} pessoa{validas.length - room! === 1 ? '' : 's'} ou faça upgrade em Plano e uso.</p>}
          </div>
        )}
        {resultado && (
          <div className="rounded-lg bg-field px-3 py-2 text-[12.5px] space-y-0.5">
            <p className="font-medium text-ink">{resultado.filter((r) => r.ok).length} criada(s). Ficaram na caixa as que não entraram:</p>
            {resultado.filter((r) => !r.ok).map((r) => <p key={r.email} className="text-danger-ink">{r.name} ({r.email}) — {r.error}</p>)}
          </div>
        )}
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
