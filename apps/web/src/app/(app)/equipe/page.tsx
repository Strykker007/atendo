'use client';
import { useState } from 'react';
import { Plus, KeyRound, Power, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useAgents, useCreateAgent, useUpdateAgent, useUsage, useMe, useResendInvite, useInviteLink, useProfiles, useCan, type Agent } from '@/lib/hooks';
import { AccessProfiles } from '@/components/settings/AccessProfiles';
import { MailCheck, Send, Link as LinkIcon } from 'lucide-react';

export default function EquipePage() {
  const me = useMe();
  const canManageTeam = useCan('team.manage');
  // esconder na tela é conveniência; quem autoriza é a API, que checa a cada requisição
  const isAdmin = canManageTeam;
  const agents = useAgents();
  const profiles = useProfiles();
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const usage = useUsage();
  const create = useCreateAgent();
  const update = useUpdateAgent();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<Agent | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const resend = useResendInvite();
  const inviteLink = useInviteLink();
  const [linkId, setLinkId] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
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
  const full = max !== undefined && count >= max;

  return (
    <PageShell width="max-w-4xl">
      <PageHeader
        title="Equipe"
        subtitle={<>Atendentes atendem; gerentes veem tudo, transferem e orientam por nota interna. {max !== undefined && <>Plano <b>{usage.data?.plan}</b>: {count}/{max} membros.</>}</>}
        action={isAdmin && <Button onClick={() => setCreating(true)} disabled={full} title={full ? 'Limite do plano atingido' : undefined} icon={<Plus size={16} />}>Novo atendente</Button>}
      />

      {full && <p className="rounded-lg bg-warn-soft border border-warn/30 px-4 py-2 text-sm text-warn-ink">Limite de atendentes do plano atingido. Desative alguém ou faça upgrade em <b>Plano e uso</b>.</p>}

      {agents.isLoading && <SkeletonRows rows={3} />}
      {agents.data?.length === 0 && <Empty icon={<Users size={36} />} title="Nenhum usuário" text="Adicione atendentes para dividir o atendimento." />}

      {!!agents.data?.length && (
        <div className="rounded-2xl bg-panel border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-field text-left text-xs text-muted uppercase tracking-wide">
              <tr><th className="px-5 py-2.5">Nome</th><th className="px-5 py-2.5 hidden sm:table-cell">E-mail</th><th className="px-5 py-2.5">Perfil de acesso</th><th className="px-5 py-2.5 hidden md:table-cell">Último acesso</th><th className="px-5 py-2.5"></th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {agents.data.map((a) => (
                <tr key={a.id} className={cn(!a.isActive && 'opacity-50')}>
                  <td className="px-5 py-3 font-medium">{a.name}{a.id === me.data?.id && <span className="ml-2 text-xs text-faint">(você)</span>}</td>
                  <td className="px-5 py-3 text-muted hidden sm:table-cell">{a.email}</td>
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
                            setLink(r.link);
                            try { await navigator.clipboard.writeText(r.link); toast.ok('Link copiado — mande para o atendente'); }
                            catch { toast.ok('Link gerado abaixo'); }
                          } catch (err) { toast.err(err); } finally { setLinkId(null); }
                        }}
                      >
                        Copiar link do convite
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Send size={12} />} loading={resendingId === a.id} onClick={async () => { setResendingId(a.id); try { const r = await resend.mutateAsync(a.id); if (r.emailSent) toast.ok(`Convite reenviado para ${a.email}`); else { setLink(r.inviteLink); toast.ok('E-mail não configurado — use o link do convite'); } } catch (err) { toast.err(err); } finally { setResendingId(null); } }}>Reenviar por e-mail</Button>
                      </>
                    )}
                    {isAdmin && (a.role === 'agent' || (a.role === 'manager' && me.data?.role !== 'manager')) && (
                      <>
                        <button onClick={() => setResetting(a)} className="text-faint hover:text-ink p-1" title="Redefinir senha"><KeyRound size={15} /></button>
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

      {link && (
        <div className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm space-y-2">
          <div className="flex items-center gap-2 font-medium text-accent-ink"><LinkIcon size={14} /> Link do convite (vale 3 dias)</div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded-lg bg-panel border border-line px-2.5 py-1.5 text-[11.5px] font-mono">{link}</code>
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(link).then(() => toast.ok('Copiado')).catch(() => undefined)}>Copiar</Button>
            <Button size="sm" variant="ghost" onClick={() => setLink(null)}>Fechar</Button>
          </div>
          <p className="text-[11.5px] text-muted">Mande por WhatsApp. Ao abrir, o atendente define a própria senha. Gerar um link novo invalida este.</p>
        </div>
      )}

      <AccessProfiles />

      <CreateAgentModal open={creating} onClose={() => setCreating(false)} canCreateManager={me.data?.role !== 'manager'} onSubmit={(b) => create.mutateAsync(b).then((r) => { if (r.invited) { setLink(r.inviteLink ?? null); toast.ok(r.emailSent ? `Convite enviado para ${b.email}` : 'Atendente criado — mande o link do convite'); } else toast.ok(b.role === 'manager' ? 'Gerente criado' : 'Atendente criado'); setCreating(false); }).catch(toast.err)} pending={create.isPending} />
      <ResetPasswordModal agent={resetting} onClose={() => setResetting(null)} onSubmit={(password) => resetting && update.mutateAsync({ id: resetting.id, password }).then(() => { toast.ok('Senha redefinida'); setResetting(null); }).catch(toast.err)} pending={update.isPending} />
    </PageShell>
  );
}

function CreateAgentModal({ open, onClose, onSubmit, pending, canCreateManager }: { open: boolean; onClose: () => void; onSubmit: (b: { name: string; email: string; password?: string; role: 'agent' | 'manager' }) => void; pending: boolean; canCreateManager: boolean }) {
  const [f, setF] = useState<{ name: string; email: string; password: string; role: 'agent' | 'manager' }>({ name: '', email: '', password: '', role: 'agent' });
  const [manual, setManual] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Novo membro da equipe" width="max-w-sm">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...f, password: manual ? f.password : undefined }); }} className="space-y-4">
        {canCreateManager && (
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
