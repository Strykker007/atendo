'use client';
import { useState } from 'react';
import { Plus, Pencil, Trash2, Folder, Zap, GripVertical } from 'lucide-react';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { useQuickReplies, useCreateFolder, useUpdateFolder, useDeleteFolder, useCreateReply, useUpdateReply, useDeleteReply, type Folder as FolderT } from '@/lib/hooks';

type Reply = FolderT['replies'][number];

/** Configurações do tenant. Por enquanto: respostas rápidas. Outras seções entram aqui. */
export default function ConfiguracoesPage() {
  const folders = useQuickReplies();
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const createReply = useCreateReply();
  const updateReply = useUpdateReply();
  const deleteReply = useDeleteReply();

  const [folderModal, setFolderModal] = useState<{ id?: string; name: string } | null>(null);
  const [replyModal, setReplyModal] = useState<{ id?: string; folderId: string; title: string; body: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'folder' | 'reply'; id: string; name: string; count?: number } | null>(null);

  async function saveFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!folderModal) return;
    try {
      if (folderModal.id) await updateFolder.mutateAsync({ id: folderModal.id, name: folderModal.name });
      else await createFolder.mutateAsync({ name: folderModal.name });
      toast.ok('Pasta salva');
      setFolderModal(null);
    } catch (err) { toast.err(err); }
  }
  async function saveReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyModal) return;
    try {
      if (replyModal.id) await updateReply.mutateAsync({ id: replyModal.id, title: replyModal.title, body: replyModal.body });
      else await createReply.mutateAsync({ folderId: replyModal.folderId, title: replyModal.title, body: replyModal.body });
      toast.ok('Resposta salva');
      setReplyModal(null);
    } catch (err) { toast.err(err); }
  }

  return (
    <PageShell width="max-w-4xl">
      <PageHeader
        title="Respostas rápidas"
        subtitle={<>Organize em pastas. No chat, o atendente clica e o texto vai para o campo de digitação. Variáveis: <code className="bg-field px-1 rounded">{'{{contact.name}}'}</code> <code className="bg-field px-1 rounded">{'{{agent.name}}'}</code></>}
        action={<Button onClick={() => setFolderModal({ name: '' })} icon={<Plus size={16} />}>Nova pasta</Button>}
      />

      {folders.isLoading && <SkeletonRows rows={3} />}
      {folders.data?.length === 0 && <Empty icon={<Zap size={36} />} title="Nenhuma pasta" text='Crie uma pasta como "Saudações" ou "Pós-venda" e adicione respostas.' />}

      <div className="space-y-4">
        {folders.data?.map((f) => (
          <div key={f.id} className="rounded-2xl bg-panel border border-line">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-line">
              <Folder size={16} className="text-warn" />
              <span className="font-medium text-sm flex-1">{f.name}</span>
              <span className="text-xs text-faint mr-2">{f.replies.length}</span>
              <button onClick={() => setReplyModal({ folderId: f.id, title: '', body: '' })} className="text-xs rounded-lg border border-line px-2 py-1 text-ink hover:bg-field"><Plus size={12} className="inline -mt-0.5" /> Resposta</button>
              <button onClick={() => setFolderModal({ id: f.id, name: f.name })} className="text-faint hover:text-ink p-1"><Pencil size={14} /></button>
              <button onClick={() => setConfirm({ kind: 'folder', id: f.id, name: f.name, count: f.replies.length })} className="text-faint hover:text-danger p-1"><Trash2 size={14} /></button>
            </div>
            {f.replies.length === 0 && <p className="px-5 py-3 text-xs text-faint">Pasta vazia.</p>}
            <ul className="divide-y divide-line">
              {f.replies.map((r: Reply) => (
                <li key={r.id} className="flex items-start gap-3 px-5 py-3">
                  <GripVertical size={14} className="text-faint mt-1 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{r.title}</div>
                    <div className="text-xs text-muted whitespace-pre-wrap line-clamp-2">{r.body}</div>
                  </div>
                  <button onClick={() => setReplyModal({ id: r.id, folderId: f.id, title: r.title, body: r.body })} className="text-faint hover:text-ink p-1"><Pencil size={14} /></button>
                  <button onClick={() => setConfirm({ kind: 'reply', id: r.id, name: r.title })} className="text-faint hover:text-danger p-1"><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <Modal open={!!folderModal} onClose={() => setFolderModal(null)} title={folderModal?.id ? 'Renomear pasta' : 'Nova pasta'} width="max-w-sm">
        <form onSubmit={saveFolder} className="space-y-4">
          <Field label="Nome"><input className={inputCls} value={folderModal?.name ?? ''} onChange={(e) => setFolderModal({ ...folderModal!, name: e.target.value })} maxLength={60} required autoFocus /></Field>
          <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={() => setFolderModal(null)}>Cancelar</Button><Button type="submit" loading={createFolder.isPending || updateFolder.isPending} loadingText="Salvando…">Salvar</Button></div>
        </form>
      </Modal>

      <Modal open={!!replyModal} onClose={() => setReplyModal(null)} title={replyModal?.id ? 'Editar resposta' : 'Nova resposta'}>
        <form onSubmit={saveReply} className="space-y-4">
          <Field label="Título" hint="Como aparece na lista do painel"><input className={inputCls} value={replyModal?.title ?? ''} onChange={(e) => setReplyModal({ ...replyModal!, title: e.target.value })} maxLength={80} required autoFocus /></Field>
          <Field label="Mensagem">
            <textarea className={`${inputCls} min-h-32`} value={replyModal?.body ?? ''} onChange={(e) => setReplyModal({ ...replyModal!, body: e.target.value })} maxLength={4096} required />
          </Field>
          <div className="flex flex-wrap gap-1 text-xs">
            <span className="text-faint mr-1">Inserir:</span>
            {['{{contact.name}}', '{{agent.name}}'].map((v) => (
              <button type="button" key={v} onClick={() => setReplyModal({ ...replyModal!, body: (replyModal?.body ?? '') + v })} className="rounded bg-field px-1.5 py-0.5 font-mono hover:bg-line-strong">{v}</button>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={() => setReplyModal(null)}>Cancelar</Button><Button type="submit" loading={createReply.isPending || updateReply.isPending} loadingText="Salvando…">Salvar</Button></div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'folder' ? 'Excluir pasta' : 'Excluir resposta'}
        danger
        confirmLabel="Excluir"
        text={confirm?.kind === 'folder' ? `A pasta "${confirm.name}" e suas ${confirm.count} resposta(s) serão removidas.` : `A resposta "${confirm?.name}" será removida.`}
        onConfirm={async () => { if (!confirm) return; try { await (confirm.kind === 'folder' ? deleteFolder : deleteReply).mutateAsync(confirm.id); toast.ok('Excluído'); } catch (err) { toast.err(err); throw err; } }}
      />
    </PageShell>
  );
}
