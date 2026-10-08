'use client';
import { useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Paperclip, X, Plus, Pencil, Trash2, Folder, FolderOpen, Zap, GripVertical, ChevronDown, ChevronRight, Copy, Download, Upload, Star } from 'lucide-react';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextWithVars, type FlowVar } from '@/components/flows/TextWithVars';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { usePersistedState } from '@/lib/persisted';
import { cn, downloadJson, safeFileName } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { uploadFile, mediaTypeOf, useCan, useMe, useQuickReplies, useCreateFolder, useUpdateFolder, useDeleteFolder, useCreateReply, useUpdateReply, useDeleteReply, useReorderFolders, useReorderReplies, useExportReply, useExportReplies, useDuplicateReplies, useImportReplies, type QuickReplyItem, type Folder as FolderT } from '@/lib/hooks';

/** Além das do sistema e dos campos da ficha (que o TextWithVars já traz). */
const REPLY_VARS: FlowVar[] = [{ key: 'agent.name', label: 'Nome de quem está atendendo', source: 'system' }];

type Reply = FolderT['replies'][number];

/**
 * Respostas rápidas: pastas e mensagens prontas que o atendente usa no chat.
 *
 * Saiu de Configurações e virou módulo próprio — eram 115 das 222 linhas daquela página, e
 * quem vem configurar aparência ou horário não tem nada a ver com manter um catálogo de
 * respostas que a equipe usa o dia inteiro.
 */
export default function RespostasPage() {
  const me = useMe();
  const podeEditar = useCan('quick_replies.manage');
  const folders = useQuickReplies();
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const createReply = useCreateReply();
  const updateReply = useUpdateReply();
  const deleteReply = useDeleteReply();
  const reorderFolders = useReorderFolders();
  const reorderReplies = useReorderReplies();
  const exportReply = useExportReply();
  const exportReplies = useExportReplies();
  const duplicate = useDuplicateReplies();
  const importReplies = useImportReplies();
  const fileInput = useRef<HTMLInputElement>(null);

  // seleção para exportar/duplicar em lote — mesmo comportamento da listagem de fluxos
  const [selected, setSelected] = useState<string[]>([]);
  const allIds = folders.data?.flatMap((f) => f.replies.map((r) => r.id)) ?? [];
  const sel = selected.filter((id) => allIds.includes(id));
  const allOn = allIds.length > 0 && sel.length === allIds.length;
  const toggle = (ids: string[], on: boolean) => setSelected((s) => (on ? [...new Set([...s, ...ids])] : s.filter((x) => !ids.includes(x))));
  const warn = (warnings: string[]) => warnings.forEach((w) => toast.err(w));

  async function onDuplicate(ids: string[]) {
    try {
      const { replies } = await duplicate.mutateAsync(ids);
      toast.ok(replies.length === 1 ? `"${replies[0].title}" criada` : `${replies.length} cópias criadas`);
      setSelected([]);
    } catch (err) { toast.err(err); }
  }
  async function onExport(r: Reply) {
    try {
      const { portable, warnings } = await exportReply.mutateAsync(r.id);
      downloadJson(portable, `${safeFileName(r.title, 'resposta')}.resposta.json`);
      warn(warnings);
    } catch (err) { toast.err(err); }
  }
  async function onExportSelected() {
    try {
      const { bundle, warnings } = await exportReplies.mutateAsync(sel);
      downloadJson(bundle, `respostas-${new Date().toISOString().slice(0, 10)}.respostas.json`);
      warn(warnings);
    } catch (err) { toast.err(err); }
  }
  async function onImport(file: File) {
    try {
      const { replies, warnings } = await importReplies.mutateAsync(JSON.parse(await file.text()));
      toast.ok(replies.length === 1 ? `"${replies[0].title}" importada` : `${replies.length} respostas importadas`);
      warn(warnings);
    } catch (err) { toast.err(err instanceof SyntaxError ? 'Arquivo não é um JSON válido.' : err); }
  }

  const [folderModal, setFolderModal] = useState<{ id?: string; name: string } | null>(null);
  const [replyModal, setReplyModal] = useState<(Partial<QuickReplyItem> & { folderId: string; title: string; body: string }) | null>(null);
  const [uploadingReply, setUploadingReply] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'folder' | 'reply'; id: string; name: string; count?: number } | null>(null);
  /**
   * Guarda as pastas FECHADAS, não as abertas.
   *
   * É o inverso do painel do chat, e de propósito: lá o atendente quer achar duas respostas
   * entre muitas, aqui a pessoa veio ver o catálogo. Guardando as fechadas, a página nasce
   * mostrando tudo e quem tem muitas pastas fecha as que não interessam — e encontra assim
   * na próxima vez.
   */
  const [fechadas, setFechadas] = usePersistedState<string[]>('pastas-respostas-fechadas', []);
  const alternar = (id: string) => setFechadas((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  /**
   * Soltou: monta a árvore nova, grava no cache na hora e manda só o que mudou de lugar.
   * Resposta pode ir para outra pasta — aí as duas pastas são renumeradas.
   */
  function onDragEnd(r: DropResult) {
    const tree = folders.data;
    if (!tree || !r.destination) return;
    const { source: from, destination: to } = r;
    if (from.droppableId === to.droppableId && from.index === to.index) return;
    const onError = (err: unknown) => toast.err(err);

    if (r.type === 'FOLDER') {
      const next = [...tree];
      const [moved] = next.splice(from.index, 1);
      next.splice(to.index, 0, moved);
      reorderFolders.mutate({ tree: next, items: next.map((f, position) => ({ id: f.id, position })) }, { onError });
      return;
    }

    const next = tree.map((f) => ({ ...f, replies: [...f.replies] }));
    const src = next.find((f) => f.id === from.droppableId);
    const dst = next.find((f) => f.id === to.droppableId);
    if (!src || !dst) return;
    const [moved] = src.replies.splice(from.index, 1);
    dst.replies.splice(to.index, 0, moved);
    const items = dst.replies.map((x, position) => ({ id: x.id, position, folderId: dst.id }));
    if (src !== dst) items.push(...src.replies.map((x, position) => ({ id: x.id, position, folderId: src.id })));
    reorderReplies.mutate({ tree: next, items }, { onError });
  }

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
      const midia = { mediaKey: replyModal.mediaKey ?? null, mediaType: replyModal.mediaType ?? null, mediaName: replyModal.mediaName ?? null, mediaMime: replyModal.mediaMime ?? null };
      if (replyModal.id) await updateReply.mutateAsync({ id: replyModal.id, title: replyModal.title, body: replyModal.body, ...midia });
      else await createReply.mutateAsync({ folderId: replyModal.folderId, title: replyModal.title, body: replyModal.body, ...midia });
      toast.ok('Resposta salva');
      setReplyModal(null);
    } catch (err) { toast.err(err); }
  }

  if (me.data?.role === 'super_admin') {
    return <PageShell width="max-w-4xl"><PageHeader title="Respostas rápidas" subtitle="Área de cliente — entre como um cliente em Clientes para gerenciar as respostas dele." /></PageShell>;
  }

  return (
    <PageShell width="max-w-4xl">
      <PageHeader
        title="Respostas rápidas"
        subtitle={<>Organize em pastas. No chat, o atendente clica e o texto vai para o campo de digitação. Use “Inserir variável” para nome do cliente, saudação, empresa e campos da ficha.</>}
        action={podeEditar && (
          <div className="flex gap-2">
            <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImport(f); }} />
            <Button variant="ghost" icon={<Upload size={16} />} loading={importReplies.isPending} onClick={() => fileInput.current?.click()}>Importar</Button>
            <Button onClick={() => setFolderModal({ name: '' })} icon={<Plus size={16} />}>Nova pasta</Button>
          </div>
        )}
      />

      {podeEditar && allIds.length > 0 && (
        <div className="flex items-center gap-3 mb-4 rounded-xl border border-line bg-panel px-4 py-2 text-xs">
          <input type="checkbox" aria-label="Selecionar todas" checked={allOn} ref={(el) => { if (el) el.indeterminate = sel.length > 0 && !allOn; }} onChange={() => setSelected(allOn ? [] : allIds)} />
          <span className="text-muted flex-1">{sel.length ? `${sel.length} selecionada(s)` : 'Selecionar todas'}</span>
          {sel.length > 0 && (
            <>
              <Button size="sm" variant="ghost" icon={<Copy size={13} />} loading={duplicate.isPending} onClick={() => onDuplicate(sel)}>Duplicar</Button>
              <Button size="sm" variant="ghost" icon={<Download size={13} />} loading={exportReplies.isPending} onClick={onExportSelected}>Exportar selecionadas</Button>
            </>
          )}
        </div>
      )}

      {folders.isLoading && <SkeletonRows rows={3} />}
      {folders.data?.length === 0 && <Empty icon={<Zap size={36} />} title="Nenhuma pasta" text='Crie uma pasta como "Saudações" ou "Pós-venda" e adicione respostas.' />}

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="folders" type="FOLDER">
          {(fp) => (
            <div ref={fp.innerRef} {...fp.droppableProps} className="space-y-4">
              {folders.data?.map((f, fi) => (
                <Draggable key={f.id} draggableId={`folder:${f.id}`} index={fi} isDragDisabled={!podeEditar}>
                  {(fd, fs) => (
                    <div ref={fd.innerRef} {...fd.draggableProps} className={cn('rounded-2xl bg-panel border border-line', fs.isDragging && 'shadow-lg')}>
                      <div className={cn('flex items-center gap-2 px-5 py-3', !fechadas.includes(f.id) && 'border-b border-line')}>
                        <span {...fd.dragHandleProps} className={cn('text-faint -ml-2', podeEditar ? 'hover:text-ink cursor-grab' : 'invisible')} title={podeEditar ? 'Arraste para reordenar' : undefined}><GripVertical size={14} /></span>
                        {podeEditar && f.replies.length > 0 && (() => {
                          const ids = f.replies.map((r) => r.id);
                          const on = ids.filter((id) => sel.includes(id)).length;
                          return <input type="checkbox" title="Selecionar a pasta inteira" checked={on === ids.length} ref={(el) => { if (el) el.indeterminate = on > 0 && on < ids.length; }} onChange={() => toggle(ids, on !== ids.length)} />;
                        })()}
                        <button onClick={() => alternar(f.id)} className="flex items-center gap-2 flex-1 min-w-0 text-left" title={fechadas.includes(f.id) ? 'Abrir pasta' : 'Fechar pasta'}>
                          {fechadas.includes(f.id) ? <ChevronRight size={14} className="text-faint shrink-0" /> : <ChevronDown size={14} className="text-faint shrink-0" />}
                          {fechadas.includes(f.id) ? <Folder size={16} className="text-warn shrink-0" /> : <FolderOpen size={16} className="text-warn shrink-0" />}
                          <span className="font-medium text-sm truncate">{f.name}</span>
                        </button>
                        <span className="text-xs text-faint mr-2">{f.replies.length}</span>
                        {podeEditar && <>
                          <button onClick={() => setReplyModal({ folderId: f.id, title: '', body: '' })} className="text-xs rounded-lg border border-line px-2 py-1 text-ink hover:bg-field"><Plus size={12} className="inline -mt-0.5" /> Resposta</button>
                          <button onClick={() => setFolderModal({ id: f.id, name: f.name })} className="text-faint hover:text-ink p-1"><Pencil size={14} /></button>
                          <button onClick={() => setConfirm({ kind: 'folder', id: f.id, name: f.name, count: f.replies.length })} className="text-faint hover:text-danger p-1"><Trash2 size={14} /></button>
                        </>}
                      </div>
                      {/* pasta fechada não recebe resposta arrastada: não dá para ver onde ela cairia */}
                      <Droppable droppableId={f.id} type="REPLY" isDropDisabled={fechadas.includes(f.id)}>
                        {(rp, rs) => (
                          <ul ref={rp.innerRef} {...rp.droppableProps} className={cn('divide-y divide-line transition-colors', fechadas.includes(f.id) && 'hidden', rs.isDraggingOver && 'bg-accent/5')}>
                            {f.replies.map((r: Reply, ri) => (
                              <Draggable key={r.id} draggableId={r.id} index={ri} isDragDisabled={!podeEditar}>
                                {(dp, ds) => (
                                  <li ref={dp.innerRef} {...dp.draggableProps} className={cn('flex items-start gap-3 px-5 py-3 bg-panel', ds.isDragging && 'shadow-lg rounded-lg')}>
                                    <span {...dp.dragHandleProps} className={cn('text-faint mt-1 shrink-0', podeEditar && 'hover:text-ink cursor-grab')} title={podeEditar ? 'Arraste para reordenar' : undefined}><GripVertical size={14} /></span>
                                    {podeEditar && <input type="checkbox" className="mt-1 shrink-0" aria-label={`Selecionar ${r.title}`} checked={sel.includes(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} />}
                                    <div className="min-w-0 flex-1">
                                      <div className="text-sm font-medium">{r.title}</div>
                                      {r.body || r.mediaKey
                                        ? <div className="text-xs text-muted whitespace-pre-wrap line-clamp-2">{r.body}</div>
                                        : <div className="text-xs text-warn-ink">Sem texto ainda — clique no lápis para escrever.</div>}
                                    </div>
                                    {podeEditar && <>
                                      <button
                                        title={r.isPinned ? 'Fixada no topo do chat — clique para desafixar' : 'Fixar no topo do painel do chat'}
                                        onClick={() => updateReply.mutateAsync({ id: r.id, isPinned: !r.isPinned }).then(() => toast.ok(r.isPinned ? 'Resposta desafixada' : 'Resposta fixada no topo do chat')).catch(toast.err)}
                                        className={cn('p-1 rounded-md', r.isPinned ? 'text-warn-ink bg-warn-soft' : 'text-faint hover:text-ink')}
                                      >
                                        <Star size={14} className={cn(r.isPinned && 'fill-current')} />
                                      </button>
                                      <button title="Duplicar" onClick={() => onDuplicate([r.id])} className="text-faint hover:text-accent-ink p-1"><Copy size={14} /></button>
                                      <button title="Exportar para usar em outro cliente" onClick={() => onExport(r)} className="text-faint hover:text-accent-ink p-1"><Download size={14} /></button>
                                      <button onClick={() => setReplyModal({ id: r.id, folderId: f.id, title: r.title, body: r.body })} className="text-faint hover:text-ink p-1"><Pencil size={14} /></button>
                                      <button onClick={() => setConfirm({ kind: 'reply', id: r.id, name: r.title })} className="text-faint hover:text-danger p-1"><Trash2 size={14} /></button>
                                    </>}
                                  </li>
                                )}
                              </Draggable>
                            ))}
                            {rp.placeholder}
                            {f.replies.length === 0 && !rs.isDraggingOver && <li className="px-5 py-3 text-xs text-faint">{podeEditar ? 'Pasta vazia — arraste uma resposta para cá.' : 'Pasta vazia.'}</li>}
                          </ul>
                        )}
                      </Droppable>
                    </div>
                  )}
                </Draggable>
              ))}
              {fp.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

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
            <TextWithVars
              value={replyModal?.body ?? ''}
              onChange={(body) => setReplyModal((m) => m && { ...m, body })}
              vars={REPLY_VARS}
              flowVarsGroup={false}
              formatting
              className="min-h-32"
              maxLength={4096}
              required={!replyModal?.mediaKey}
            />
          </Field>
          <Field label="Anexo (opcional)" hint="Áudio, foto, vídeo ou arquivo. Com anexo, a mensagem acima vira a legenda.">
            {replyModal?.mediaKey ? (
              <div className="flex items-center gap-2 rounded-lg bg-field px-3 py-2 text-sm">
                {replyModal.mediaType === 'image' && replyModal.mediaUrl
                  ? <img src={replyModal.mediaUrl} alt="" className="w-12 h-12 rounded object-cover" />
                  : <Paperclip size={18} className="text-muted" />}
                <span className="flex-1 min-w-0 truncate">{replyModal.mediaName}</span>
                <button type="button" onClick={() => setReplyModal({ ...replyModal!, mediaKey: null, mediaType: null, mediaName: null, mediaMime: null, mediaUrl: null })} className="text-faint hover:text-danger" title="Remover anexo"><X size={15} /></button>
              </div>
            ) : (
              <label className="inline-flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-sm text-muted cursor-pointer hover:bg-field">
                <Paperclip size={15} /> {uploadingReply ? 'Enviando…' : 'Escolher arquivo'}
                <input
                  type="file"
                  hidden
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/3gpp,audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/webm,application/pdf,.doc,.docx,.xls,.xlsx"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setUploadingReply(true);
                    try {
                      const up = await uploadFile(file);
                      setReplyModal((m) => m && { ...m, mediaKey: up.key, mediaUrl: up.url, mediaName: up.fileName, mediaMime: up.mimeType, mediaType: mediaTypeOf(up.mimeType) });
                    } catch (err) { toast.err(err); } finally { setUploadingReply(false); }
                  }}
                />
              </label>
            )}
          </Field>

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
