'use client';
import { useState } from 'react';
import { Plus, Pencil, Trash2, Folder, Zap, GripVertical } from 'lucide-react';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Modal, Field, inputCls, btnPrimary, btnGhost } from '@/components/ui/Modal';
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
        subtitle={<>Organize em pastas. No chat, o atendente clica e o texto vai para o campo de digitação. Variáveis: <code className="bg-surface-muted px-1 rounded">{'{{contact.name}}'}</code> <code className="bg-surface-muted px-1 rounded">{'{{agent.name}}'}</code></>}
        action={<button onClick={() => setFolderModal({ name: '' })} className={btnPrimary}><Plus size={16} className="inline mr-1 -mt-0.5" /> Nova pasta</button>}
      />

      {folders.data?.length === 0 && <Empty icon={<Zap size={36} />} title="Nenhuma pasta" text='Crie uma pasta como "Saudações" ou "Pós-venda" e adicione respostas.' />}

      <div className="space-y-4">
        {folders.data?.map((f) => (
          <div key={f.id} className="rounded-2xl bg-white border border-surface-border">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-border">
              <Folder size={16} className="text-amber-500" />
              <span className="font-medium text-sm flex-1">{f.name}</span>
              <span className="text-xs text-gray-400 mr-2">{f.replies.length}</span>
              <button onClick={() => setReplyModal({ folderId: f.id, title: '', body: '' })} className="text-xs rounded-lg border border-surface-border px-2 py-1 text-gray-700 hover:bg-surface-muted"><Plus size={12} className="inline -mt-0.5" /> Resposta</button>
              <button onClick={() => setFolderModal({ id: f.id, name: f.name })} className="text-gray-400 hover:text-gray-700 p-1"><Pencil size={14} /></button>
              <button onClick={() => setConfirm({ kind: 'folder', id: f.id, name: f.name, count: f.replies.length })} className="text-gray-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
            </div>
            {f.replies.length === 0 && <p className="px-5 py-3 text-xs text-gray-400">Pasta vazia.</p>}
            <ul className="divide-y divide-surface-border">
              {f.replies.map((r: Reply) => (
                <li key={r.id} className="flex items-start gap-3 px-5 py-3">
                  <GripVertical size={14} className="text-gray-300 mt-1 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{r.title}</div>
                    <div className="text-xs text-gray-500 whitespace-pre-wrap line-clamp-2">{r.body}</div>
                  </div>
                  <button onClick={() => setReplyModal({ id: r.id, folderId: f.id, title: r.title, body: r.body })} className="text-gray-400 hover:text-gray-700 p-1"><Pencil size={14} /></button>
                  <button onClick={() => setConfirm({ kind: 'reply', id: r.id, name: r.title })} className="text-gray-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <Modal open={!!folderModal} onClose={() => setFolderModal(null)} title={folderModal?.id ? 'Renomear pasta' : 'Nova pasta'} width="max-w-sm">
        <form onSubmit={saveFolder} className="space-y-4">
          <Field label="Nome"><input className={inputCls} value={folderModal?.name ?? ''} onChange={(e) => setFolderModal({ ...folderModal!, name: e.target.value })} maxLength={60} required autoFocus /></Field>
          <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setFolderModal(null)} className={btnGhost}>Cancelar</button><button className={btnPrimary}>Salvar</button></div>
        </form>
      </Modal>

      <Modal open={!!replyModal} onClose={() => setReplyModal(null)} title={replyModal?.id ? 'Editar resposta' : 'Nova resposta'}>
        <form onSubmit={saveReply} className="space-y-4">
          <Field label="Título" hint="Como aparece na lista do painel"><input className={inputCls} value={replyModal?.title ?? ''} onChange={(e) => setReplyModal({ ...replyModal!, title: e.target.value })} maxLength={80} required autoFocus /></Field>
          <Field label="Mensagem">
            <textarea className={`${inputCls} min-h-32`} value={replyModal?.body ?? ''} onChange={(e) => setReplyModal({ ...replyModal!, body: e.target.value })} maxLength={4096} required />
          </Field>
          <div className="flex flex-wrap gap-1 text-xs">
            <span className="text-gray-400 mr-1">Inserir:</span>
            {['{{contact.name}}', '{{agent.name}}'].map((v) => (
              <button type="button" key={v} onClick={() => setReplyModal({ ...replyModal!, body: (replyModal?.body ?? '') + v })} className="rounded bg-surface-muted px-1.5 py-0.5 font-mono hover:bg-gray-200">{v}</button>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setReplyModal(null)} className={btnGhost}>Cancelar</button><button className={btnPrimary}>Salvar</button></div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'folder' ? 'Excluir pasta' : 'Excluir resposta'}
        danger
        confirmLabel="Excluir"
        text={confirm?.kind === 'folder' ? `A pasta "${confirm.name}" e suas ${confirm.count} resposta(s) serão removidas.` : `A resposta "${confirm?.name}" será removida.`}
        onConfirm={() => confirm && (confirm.kind === 'folder' ? deleteFolder : deleteReply).mutateAsync(confirm.id).then(() => toast.ok('Excluído')).catch(toast.err)}
      />
    </PageShell>
  );
}
