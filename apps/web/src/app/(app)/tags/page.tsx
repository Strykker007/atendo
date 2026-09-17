'use client';
import { useState } from 'react';
import { Plus, Pencil, Trash2, Tag as TagIcon } from 'lucide-react';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Modal, Field, inputCls, btnPrimary, btnGhost } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { useTags, useCreateTag, useUpdateTag, useDeleteTag, useMe, type Tag } from '@/lib/hooks';

const PALETTE = ['#22c55e', '#f59e0b', '#6366f1', '#ec4899', '#0ea5e9', '#ef4444', '#8b5cf6', '#14b8a6', '#64748b', '#f97316'];

type TagWithCount = Tag & { _count?: { conversations: number } };

export default function TagsPage() {
  const me = useMe();
  const isAdmin = me.data?.role !== 'agent';
  const tags = useTags();
  const create = useCreateTag();
  const update = useUpdateTag();
  const remove = useDeleteTag();
  const [editing, setEditing] = useState<Partial<Tag> | null>(null);
  const [deleting, setDeleting] = useState<TagWithCount | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing?.name) return;
    try {
      if (editing.id) await update.mutateAsync({ id: editing.id, name: editing.name, color: editing.color });
      else await create.mutateAsync({ name: editing.name, color: editing.color ?? PALETTE[0] });
      toast.ok(editing.id ? 'Tag atualizada' : 'Tag criada');
      setEditing(null);
    } catch (err) {
      toast.err(err);
    }
  }

  return (
    <PageShell width="max-w-3xl">
      <PageHeader
        title="Tags"
        subtitle="Classifique conversas durante o atendimento. As tags viram filtros e relatórios."
        action={isAdmin && <button onClick={() => setEditing({ color: PALETTE[Math.floor(Math.random() * PALETTE.length)] })} className={btnPrimary}><Plus size={16} className="inline mr-1 -mt-0.5" /> Nova tag</button>}
      />

      {tags.data?.length === 0 && <Empty icon={<TagIcon size={36} />} title="Nenhuma tag" text='Crie tags como "lead com interesse" ou "comprador recorrente".' />}

      {!!tags.data?.length && (
        <div className="rounded-2xl bg-white border border-surface-border divide-y divide-surface-border">
          {(tags.data as TagWithCount[]).map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-5 py-3">
              <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: t.color }} />
              <span className="flex-1 font-medium text-sm">{t.name}</span>
              <span className="text-xs text-gray-400">{t._count?.conversations ?? 0} conversa{(t._count?.conversations ?? 0) === 1 ? '' : 's'}</span>
              {isAdmin && (
                <>
                  <button onClick={() => setEditing(t)} className="text-gray-400 hover:text-gray-700 p-1" title="Editar"><Pencil size={15} /></button>
                  <button onClick={() => setDeleting(t)} className="text-gray-400 hover:text-red-600 p-1" title="Excluir"><Trash2 size={15} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar tag' : 'Nova tag'} width="max-w-sm">
        <form onSubmit={save} className="space-y-4">
          <Field label="Nome"><input className={inputCls} value={editing?.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={40} required autoFocus /></Field>
          <Field label="Cor">
            <div className="flex flex-wrap gap-2 pt-1">
              {PALETTE.map((c) => (
                <button type="button" key={c} onClick={() => setEditing({ ...editing, color: c })} className="w-7 h-7 rounded-full ring-offset-2 transition" style={{ background: c, boxShadow: editing?.color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined }} />
              ))}
            </div>
          </Field>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            Prévia: <span className="text-[11px] text-white rounded px-1.5 py-0.5" style={{ background: editing?.color }}>{editing?.name || 'nome da tag'}</span>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setEditing(null)} className={btnGhost}>Cancelar</button>
            <button disabled={create.isPending || update.isPending} className={btnPrimary}>Salvar</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir tag"
        danger
        confirmLabel="Excluir"
        text={`A tag "${deleting?.name}" será removida de ${deleting?._count?.conversations ?? 0} conversa(s). Relatórios antigos deixam de contá-la.`}
        onConfirm={() => deleting && remove.mutateAsync(deleting.id).then(() => toast.ok('Tag excluída')).catch(toast.err)}
      />
    </PageShell>
  );
}
