'use client';
import { useState } from 'react';
import { Plus, Shield, Trash2, Pencil, Lock } from 'lucide-react';
import { PERMISSIONS, PERMISSION_GROUPS, type Permission } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { useProfiles, useCreateProfile, useUpdateProfile, useDeleteProfile, useCan, useMe, type AccessProfile } from '@/lib/hooks';

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

      <div className="rounded-2xl bg-panel border border-line divide-y divide-line">
        {profiles.data?.map((p) => (
          <div key={p.id} className="flex items-start gap-3 px-4 py-3">
            <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 bg-accent-soft text-accent-ink mt-0.5"><Shield size={15} /></span>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-ink flex items-center gap-1.5">
                {p.name}
                {p.isSystem && <span title="Perfil padrão — não pode ser excluído" className="text-faint"><Lock size={12} /></span>}
                <span className="text-xs text-muted font-normal">· {p._count.users} pessoa{p._count.users === 1 ? '' : 's'}</span>
              </div>
              {/* o que o perfil libera, por extenso: a contagem sozinha não responde
                  "o que esta pessoa pode fazer?", que é a pergunta de quem abre esta tela */}
              <div className="mt-1 flex flex-wrap gap-1">
                {p.permissions.length === 0 && <span className="text-xs text-muted">Nenhuma permissão — só atende as próprias conversas.</span>}
                {p.permissions.map((perm) => (
                  <span key={perm} className="text-[11px] rounded bg-field text-muted px-1.5 py-0.5">{PERMISSIONS[perm]}</span>
                ))}
              </div>
            </div>
            {canManage && (
              <>
                <button title="Editar" onClick={() => setEditing(p)} className="text-faint hover:text-accent-ink p-1"><Pencil size={15} /></button>
                {!p.isSystem && <button title="Excluir" onClick={() => setDeleting(p)} className="text-faint hover:text-danger p-1"><Trash2 size={15} /></button>}
              </>
            )}
          </div>
        ))}
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
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir perfil"
        danger
        confirmLabel="Excluir"
        text={`"${deleting?.name}" será removido.`}
        onConfirm={async () => { if (!deleting) return; try { await remove.mutateAsync(deleting.id); toast.ok('Perfil excluído'); } catch (err) { toast.err(err); throw err; } }}
      />
    </section>
  );
}

function ProfileModal({ open, profile, canGrant, pending, onClose, onSubmit }: {
  open: boolean;
  profile: Partial<AccessProfile> | null;
  canGrant: (p: Permission) => boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (b: { name: string; description?: string; permissions: Permission[] }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Permission[]>([]);
  const [key, setKey] = useState('');

  // recarrega os campos quando o modal abre para outro perfil
  const id = profile?.id ?? 'novo';
  if (open && key !== id) {
    setKey(id);
    setName(profile?.name ?? '');
    setDescription(profile?.description ?? '');
    setSelected(profile?.permissions ?? []);
  }

  const toggle = (p: Permission) => setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));

  return (
    <Modal open={open} onClose={onClose} title={profile?.id ? 'Editar perfil' : 'Novo perfil'}>
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit({ name, description: description || undefined, permissions: selected }); }}
        className="space-y-4"
      >
        <div className="space-y-1">
          <label className="text-sm text-muted">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            disabled={profile?.isSystem}
            placeholder="Atendente líder"
            className="w-full rounded-lg border border-line bg-field px-3 py-2 text-ink disabled:text-muted"
          />
          {profile?.isSystem && <p className="text-xs text-faint">Perfis padrão não podem ser renomeados, mas as permissões são suas.</p>}
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted">Descrição (opcional)</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} className="w-full rounded-lg border border-line bg-field px-3 py-2 text-ink" />
        </div>

        <div className="space-y-3">
          {PERMISSION_GROUPS.map((g) => (
            <div key={g.label} className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-faint">{g.label}</div>
              {g.items.map((p) => {
                const allowed = canGrant(p);
                return (
                  <label key={p} className={cn('flex items-start gap-2 text-sm', allowed ? 'text-ink cursor-pointer' : 'text-faint cursor-not-allowed')}>
                    <input type="checkbox" checked={selected.includes(p)} disabled={!allowed} onChange={() => toggle(p)} className="mt-0.5" />
                    <span>
                      {PERMISSIONS[p]}
                      {!allowed && <span className="text-xs"> — você não tem esta permissão para conceder</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={pending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
