'use client';
import { useEffect, useRef, useState } from 'react';
import { BarChart3, Check, ChevronDown, Layers, Lock, MessagesSquare, Pencil, Plus, Copy, RefreshCw, Shield, ShieldCheck, Trash2, Users, Wallet, Wand2 } from 'lucide-react';
import { PERMISSIONS, PERMISSION_GROUPS, type Permission } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Modal, inputCls } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { useProfiles, useCreateProfile, useUpdateProfile, useDeleteProfile, useApplyProfileAccess, useCan, useMe, useNumbers, useDepartments, type AccessProfile, type AccessTemplate } from '@/lib/hooks';
import { AccessGrid, type AccessState } from './AccessGrid';

/**
 * Perfis de acesso: o cliente monta o que cada função pode fazer.
 * Um enum fechado não cobre a farmácia com três gerentes iguais e a que precisa de um
 * "atendente líder" com acesso sob medida.
 */
export function AccessProfiles() {
  const me = useMe();
  const canManage = useCan('profiles.manage');
  const profiles = useProfiles();
  const create = useCreateProfile();
  const update = useUpdateProfile();
  const remove = useDeleteProfile();
  const [editing, setEditing] = useState<Partial<AccessProfile> | null>(null);
  const [deleting, setDeleting] = useState<AccessProfile | null>(null);
  const [reaplicando, setReaplicando] = useState<AccessProfile | null>(null);
  const aplicar = useApplyProfileAccess();
  const canTeam = useCan('team.manage');

  // ninguém pode conceder o que não tem — a API corta de novo, isto é só para a tela não
  // oferecer uma caixa que seria descartada no salvamento
  const mine = me.data?.permissions ?? [];
  const isOwner = me.data?.role === 'super_admin';
  const canGrant = (p: Permission) => isOwner || mine.includes(p);

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display font-semibold text-ink">Perfis de acesso</h2>
          <p className="text-sm text-muted">O que cada função pode fazer. Atribua um perfil a cada pessoa na lista acima.</p>
        </div>
        {canManage && <Button variant="ghost" icon={<Plus size={16} />} onClick={() => setEditing({ permissions: [] })}>Novo perfil</Button>}
      </div>

      {/* items-start: abrir as permissões de um cartão não estica os vizinhos da linha (ficavam altos e vazios) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 items-start">
        {profiles.data?.map((p) => <ProfileCard key={p.id} profile={p} canManage={canManage} onEdit={() => setEditing(p)} onDelete={() => setDeleting(p)}
          // cópia completa: permissões + acesso padrão, sem id (salva como perfil novo). A API corta o que quem copia não pode conceder
          onCopy={() => setEditing({ name: `${p.name} (cópia)`.slice(0, 60), description: p.description, permissions: p.permissions, accessTemplate: p.accessTemplate ?? null })}
          onReapply={canTeam ? () => setReaplicando(p) : undefined} />)}
      </div>

      <ProfileModal
        open={!!editing}
        profile={editing}
        canGrant={canGrant}
        pending={create.isPending || update.isPending}
        onClose={() => setEditing(null)}
        onSubmit={async (b) => {
          try {
            if (editing?.id) await update.mutateAsync({ id: editing.id, ...b });
            else await create.mutateAsync(b);
            toast.ok('Perfil salvo');
            setEditing(null);
          } catch (err) { toast.err(err); }
        }}
      />

      <ConfirmDialog
        open={!!reaplicando}
        onClose={() => setReaplicando(null)}
        title="Reaplicar acesso padrão"
        confirmLabel="Reaplicar"
        text={`As ${reaplicando?._count.users ?? 0} pessoa(s) com o perfil "${reaplicando?.name}" passam a ter os números, departamentos e recebimento do acesso padrão. Ajustes feitos pessoa por pessoa serão substituídos.`}
        onConfirm={async () => { if (!reaplicando) return; try { const r = await aplicar.mutateAsync(reaplicando.id); toast.ok(`Acesso padrão aplicado em ${r.applied} pessoa(s)`); } catch (err) { toast.err(err); throw err; } }}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir perfil"
        danger
        confirmLabel="Excluir"
        text={deleting?._count.users ? `"${deleting.name}" será removido. ${deleting._count.users} pessoa(s) vinculada(s) voltarão ao acesso padrão do papel.` : `"${deleting?.name}" será removido.`}
        onConfirm={async () => { if (!deleting) return; try { await remove.mutateAsync(deleting.id); toast.ok('Perfil excluído'); } catch (err) { toast.err(err); throw err; } }}
      />
    </section>
  );
}

/** Ícone de cada área de permissões (os grupos vêm de `PERMISSION_GROUPS`). */
const GROUP_ICON: Record<string, React.ReactNode> = {
  Atendimento: <MessagesSquare size={14} />,
  Conteúdo: <Layers size={14} />,
  Gestão: <BarChart3 size={14} />,
  Conta: <Wallet size={14} />,
};
const TOTAL = PERMISSION_GROUPS.reduce((n, g) => n + g.items.length, 0);

/**
 * Cartão do perfil: quantas pessoas usam, quanto de cada área ele libera (barra por grupo) e,
 * aberto, a lista por extenso — "o que esta pessoa pode fazer?" é a pergunta de quem abre aqui.
 */
function ProfileCard({ profile: p, canManage, onEdit, onDelete, onCopy, onReapply }: { profile: AccessProfile; canManage: boolean; onEdit: () => void; onDelete: () => void; onCopy: () => void; onReapply?: () => void }) {
  const [aberto, setAberto] = useState(false);
  const numbers = useNumbers();
  const departments = useDepartments();
  const t = p.accessTemplate;
  const nomesDeptos = t ? (departments.data ?? []).filter((d) => t.departmentIds.includes(d.id)).map((d) => d.name) : [];
  const resumoModelo = t
    ? `${t.allNumbers ? 'todos os números' : `${(numbers.data ?? []).filter((n) => t.numberIds.includes(n.id)).length} número(s)`} · ${nomesDeptos.length ? nomesDeptos.join(', ') : 'sem departamento'}`
    : null;
  const total = p.permissions.length >= TOTAL;
  return (
    <article className="rounded-2xl bg-panel border border-line p-4 flex flex-col gap-3">
      <header className="flex items-start gap-3">
        <span className={cn('w-9 h-9 rounded-xl grid place-items-center shrink-0', total ? 'bg-accent text-white' : 'bg-accent-soft text-accent-ink')}>{total ? <ShieldCheck size={17} /> : <Shield size={17} />}</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-ink flex items-center gap-1.5">
            <span className="truncate">{p.name}</span>
            {p.systemRole === 'tenant_admin' && <span title="Perfil essencial da conta — não pode ser excluído" className="text-faint shrink-0"><Lock size={12} /></span>}
          </h3>
          <p className="text-[12px] text-muted flex flex-wrap items-center gap-x-2">
            <span className="inline-flex items-center gap-1"><Users size={12} /> {p._count.users} pessoa{p._count.users === 1 ? '' : 's'}</span>
            <span>{total ? 'Acesso total' : `${p.permissions.length} de ${TOTAL} permissões`}</span>
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 -mr-1 -mt-1">
            <button title="Duplicar (permissões e acesso padrão)" aria-label={`Duplicar ${p.name}`} onClick={onCopy} className="text-faint hover:text-accent-ink p-1.5 rounded-lg hover:bg-field"><Copy size={15} /></button>
            <button title="Editar" aria-label={`Editar ${p.name}`} onClick={onEdit} className="text-faint hover:text-accent-ink p-1.5 rounded-lg hover:bg-field"><Pencil size={15} /></button>
            {p.systemRole !== 'tenant_admin' && <button title="Excluir" aria-label={`Excluir ${p.name}`} onClick={onDelete} className="text-faint hover:text-danger p-1.5 rounded-lg hover:bg-field"><Trash2 size={15} /></button>}
          </div>
        )}
      </header>

      {p.description && <p className="text-[12.5px] text-muted line-clamp-2">{p.description}</p>}

      {resumoModelo && (
        <div className="flex items-start gap-2 rounded-lg bg-field px-3 py-2 text-[12px]">
          <Wand2 size={13} className="mt-0.5 shrink-0 text-accent-ink" />
          <span className="min-w-0 flex-1"><b className="text-ink">Acesso padrão:</b> <span className="text-muted">{resumoModelo}</span></span>
          {onReapply && p._count.users > 0 && (
            <button type="button" onClick={onReapply} title="Aplicar o acesso padrão em quem já tem este perfil" className="shrink-0 inline-flex items-center gap-1 font-semibold text-accent-ink hover:underline"><RefreshCw size={11} /> Reaplicar</button>
          )}
        </div>
      )}

      {p.permissions.length === 0 ? (
        <p className="text-[12.5px] text-muted rounded-lg bg-field px-3 py-2">Nenhuma permissão extra — só atende as próprias conversas.</p>
      ) : (
        <ul className="space-y-1.5">
          {PERMISSION_GROUPS.map((g) => {
            const n = g.items.filter((x) => p.permissions.includes(x)).length;
            return (
              <li key={g.label} className="flex items-center gap-2 text-[12px]">
                <span className={cn('w-28 shrink-0 inline-flex items-center gap-1.5', n ? 'text-ink' : 'text-faint')}>{GROUP_ICON[g.label]}{g.label}</span>
                <span className="flex-1 h-1.5 rounded-full bg-field overflow-hidden"><span className="block h-full rounded-full bg-accent" style={{ width: `${(n / g.items.length) * 100}%` }} /></span>
                <span className="w-9 text-right tnum text-muted">{n}/{g.items.length}</span>
              </li>
            );
          })}
        </ul>
      )}

      {p.permissions.length > 0 && (
        <div className="mt-auto pt-1">
          <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent-ink hover:underline">
            <ChevronDown size={14} className={cn('transition-transform', aberto && 'rotate-180')} /> {aberto ? 'Esconder permissões' : 'Ver permissões'}
          </button>
          {aberto && (
            <div className="mt-2 space-y-2.5">
              {PERMISSION_GROUPS.map((g) => {
                const itens = g.items.filter((x) => p.permissions.includes(x));
                if (!itens.length) return null;
                return (
                  <div key={g.label}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-faint mb-1">{g.label}</p>
                    <ul className="space-y-1">
                      {itens.map((perm) => <li key={perm} className="flex items-start gap-1.5 text-[12.5px] text-ink"><Check size={13} className="text-ok mt-0.5 shrink-0" />{PERMISSIONS[perm]}</li>)}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** Caixa "marcar a área inteira": fica no meio-termo quando só parte do grupo está marcada. */
function GroupCheck({ checked, indeterminate, disabled, onChange, label }: { checked: boolean; indeterminate: boolean; disabled: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} className="w-4 h-4 accent-[var(--accent)]" />;
}

function ProfileModal({ open, profile, canGrant, pending, onClose, onSubmit }: {
  open: boolean;
  profile: Partial<AccessProfile> | null;
  canGrant: (p: Permission) => boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (b: { name: string; description?: string; permissions: Permission[]; accessTemplate?: AccessTemplate | null }) => void;
}) {
  const me = useMe();
  const numbers = useNumbers();
  const departments = useDepartments();
  const souAdmin = me.data?.role === 'tenant_admin' || me.data?.role === 'super_admin' || !!me.data?.impersonatorId;
  const [comModelo, setComModelo] = useState(false);
  const [modelo, setModelo] = useState<AccessState>({ todos: true, ve: [], padrao: [], recebe: [], deptos: [] });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Permission[]>([]);
  const [key, setKey] = useState('');

  // recarrega os campos quando o modal abre para outro perfil
  // cópia: sem id, mas com nome — chave própria para recarregar os campos
  const id = profile?.id ?? (profile?.name ? `copia:${profile.name}` : 'novo');
  if (!open && key) setKey('');
  if (open && key !== id) {
    setKey(id);
    setName(profile?.name ?? '');
    setDescription(profile?.description ?? '');
    setSelected(profile?.permissions ?? []);
    const t = profile?.accessTemplate;
    setComModelo(!!t);
    const lista = numbers.data ?? [];
    const ves = t && !t.allNumbers ? t.numberIds : lista.filter((n) => !n.reserved).map((n) => n.id);
    setModelo(t
      ? { todos: t.allNumbers, ve: t.allNumbers ? [] : t.numberIds, padrao: t.defaultNumberIds, deptos: t.departmentIds, recebe: t.receiveAll ? ves : t.receiveNumberIds }
      : { todos: true, ve: [], padrao: [], deptos: [], recebe: ves });
  }

  /** Estado da tabela → modelo da API. "Recebe" igual a tudo que vê vira `receiveAll` (inclui números novos). */
  function paraModelo(): AccessTemplate | null {
    if (!comModelo) return null;
    const vistos = (numbers.data ?? []).filter((n) => (modelo.todos ? !n.reserved : modelo.ve.includes(n.id))).map((n) => n.id);
    const recebe = modelo.recebe.filter((id) => vistos.includes(id));
    return {
      allNumbers: modelo.todos,
      numberIds: modelo.todos ? [] : modelo.ve,
      defaultNumberIds: modelo.padrao.filter((id) => vistos.includes(id)),
      departmentIds: modelo.deptos,
      receiveAll: recebe.length === vistos.length,
      receiveNumberIds: recebe,
    };
  }

  const toggle = (p: Permission) => setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  // marcar/desmarcar em bloco só mexe no que a pessoa pode conceder
  const setMany = (perms: Permission[], on: boolean) => {
    const podem = perms.filter(canGrant);
    setSelected((s) => (on ? [...new Set([...s, ...podem])] : s.filter((x) => !podem.includes(x))));
  };
  const concediveis = PERMISSION_GROUPS.flatMap((g) => g.items).filter(canGrant);

  return (
    <Modal open={open} onClose={onClose} title={profile?.id ? 'Editar perfil' : profile?.name ? 'Duplicar perfil' : 'Novo perfil'} width="max-w-3xl">
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit({ name, description: description || undefined, permissions: selected, ...(profile?.systemRole !== 'tenant_admin' && { accessTemplate: paraModelo() }) }); }}
        className="space-y-5"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={60}
              disabled={profile?.systemRole === 'tenant_admin'}
              placeholder="Atendente líder"
              className={cn(inputCls, 'disabled:text-muted')}
            />
            {profile?.systemRole === 'tenant_admin' && <p className="text-xs text-faint">O perfil Administrador mantém este nome para identificar a conta.</p>}
            {profile?.isSystem && profile?.systemRole !== 'tenant_admin' && <p className="text-xs text-faint">Você pode adaptar o nome ao seu negócio; as permissões e o papel interno continuam os mesmos.</p>}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">Descrição <span className="text-faint font-normal">(opcional)</span></label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Ex.: lidera o turno da noite" className={inputCls} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-field px-3 py-2">
          <p className="text-[13px] text-ink"><b className="tnum">{selected.length}</b> de {TOTAL} permissões marcadas</p>
          <div className="ml-auto flex gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setMany(concediveis, true)}>Marcar todas</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMany(concediveis, false)} disabled={!selected.length}>Limpar</Button>
          </div>
        </div>

        <div className="space-y-3">
          {PERMISSION_GROUPS.map((g) => {
            const marcadas = g.items.filter((x) => selected.includes(x)).length;
            const podem = g.items.filter(canGrant);
            const todas = marcadas === g.items.length;
            return (
              <section key={g.label} className="rounded-xl border border-line">
                <header className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
                  <span className="w-7 h-7 rounded-lg bg-accent-soft text-accent-ink grid place-items-center">{GROUP_ICON[g.label]}</span>
                  <h3 className="text-sm font-semibold text-ink">{g.label}</h3>
                  <span className="text-[12px] text-muted tnum">{marcadas}/{g.items.length}</span>
                  <label className="ml-auto inline-flex items-center gap-2 text-[12.5px] text-muted cursor-pointer">
                    {todas ? 'Desmarcar área' : 'Marcar área'}
                    <GroupCheck checked={todas} indeterminate={marcadas > 0 && !todas} disabled={!podem.length} onChange={() => setMany(g.items, !todas)} label={`Marcar todas de ${g.label}`} />
                  </label>
                </header>
                <div className="grid gap-1.5 p-2 sm:grid-cols-2">
                  {g.items.map((p) => {
                    const allowed = canGrant(p);
                    const on = selected.includes(p);
                    return (
                      <label key={p} title={allowed ? undefined : 'Você não tem esta permissão para conceder'}
                        className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-colors',
                          on ? 'border-accent/50 bg-accent-soft/60' : 'border-transparent hover:bg-field',
                          allowed ? 'text-ink cursor-pointer' : 'text-faint cursor-not-allowed')}>
                        <input type="checkbox" checked={on} disabled={!allowed} onChange={() => toggle(p)} className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--accent)]" />
                        <span className="min-w-0">
                          {PERMISSIONS[p]}
                          {!allowed && <span className="flex items-center gap-1 text-[11px] mt-0.5"><Lock size={10} /> você não pode conceder</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {profile?.systemRole !== 'tenant_admin' && (
          <section className="rounded-xl border border-line p-3 space-y-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={comModelo} onChange={(e) => setComModelo(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[var(--accent)]" />
              <span>
                <span className="text-sm font-semibold text-ink inline-flex items-center gap-1.5"><Wand2 size={14} /> Acesso padrão</span>
                <span className="block text-[12.5px] text-muted">
                  Números, onde a tela abre filtrada, de onde recebe automaticamente e departamentos. Quem for criado com este perfil (um a um ou em massa) já nasce assim;
                  na tela de Acesso, trocar para este perfil oferece aplicar. Depois dá para ajustar cada pessoa sem mexer no perfil.
                </span>
              </span>
            </label>
            {comModelo && (
              <>
                <AccessGrid numbers={numbers.data ?? []} departments={departments.data ?? []} value={modelo} onChange={setModelo} canReceive={souAdmin} viewAll={selected.includes('conversations.view_all')} />
                {profile?.id && (profile._count?.users ?? 0) > 0 && <p className="text-[12px] text-muted">Mudar aqui não altera quem já tem o perfil. Para isso, use <b>Reaplicar</b> no cartão do perfil.</p>}
              </>
            )}
          </section>
        )}

        <div className="flex justify-end gap-2 sticky bottom-0 -mx-5 -mb-5 px-5 py-3 bg-panel border-t border-line">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={pending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
