'use client';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Tag as TagIcon, Columns3, CheckCircle2, ListPlus, Palette, X } from 'lucide-react';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { useTags, useCreateTag, useUpdateTag, useDeleteTag, useBulkCreateTags, useBulkUpdateTags, useBulkDeleteTags, type Tag, useCan } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { PALETTE, ColorSwatches, ColorPopover } from '@/components/ui/ColorSwatches';

type TagWithCount = Tag & { _count?: { conversations: number; contacts: number } };

/** filtros da lista: com dezenas de tags, achar as do encerramento ou as abandonadas era rolar e ler */
const FILTROS = [
  { id: 'todas', label: 'Todas', match: () => true },
  { id: 'kanban', label: 'Kanban', match: (t: TagWithCount) => t.isKanban !== false },
  { id: 'encerramento', label: 'No encerramento', match: (t: TagWithCount) => !!t.showOnClose },
  { id: 'sem-uso', label: 'Sem uso', match: (t: TagWithCount) => !t._count?.conversations && !t._count?.contacts },
] as const;
type Filtro = (typeof FILTROS)[number]['id'];

export default function TagsPage() {
  // esconder na tela é conveniência; quem autoriza é a API
  const isAdmin = useCan('tags.manage');
  const tags = useTags();
  const create = useCreateTag();
  const update = useUpdateTag();
  const remove = useDeleteTag();
  const [editing, setEditing] = useState<Partial<Tag> | null>(null);
  const [deleting, setDeleting] = useState<TagWithCount | null>(null);
  const bulkCreate = useBulkCreateTags();
  const bulkUpdate = useBulkUpdateTags();
  const bulkDelete = useBulkDeleteTags();
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [sel, setSel] = useState<string[]>([]);
  const todas = (tags.data ?? []) as TagWithCount[];
  /** `cores`: cor escolhida para cada nome; sem ela, a "cor de todas" */
  const [lote, setLote] = useState<{ nomes: string; color: string; isKanban: boolean; showOnClose: boolean; cores: Record<string, string> } | null>(null);
  // nomes do lote na ordem, sem repetir (a API faz o mesmo: vale a primeira)
  const nomesDoLote = lote ? [...new Set(lote.nomes.split(/\r?\n|;/).map((n) => n.trim().slice(0, 40)).filter(Boolean))] : [];
  const existentes = new Set(todas.map((t) => t.name.toLowerCase()));
  const novosDoLote = nomesDoLote.filter((n) => !existentes.has(n.toLowerCase()));
  const [excluindoLote, setExcluindoLote] = useState(false);
  const [paleta, setPaleta] = useState(false);
  /** tag com o seletor de cor aberto na própria linha */
  const [corDe, setCorDe] = useState<string | null>(null);

  const visiveis = useMemo(() => {
    const f = FILTROS.find((x) => x.id === filtro)!;
    const busca = q.trim().toLowerCase();
    return todas.filter((t) => f.match(t) && (!busca || t.name.toLowerCase().includes(busca)));
  }, [todas, filtro, q]);
  // tag excluída (aqui ou por outra pessoa) sai da seleção
  useEffect(() => setSel((s) => s.filter((id) => todas.some((t) => t.id === id))), [todas]);
  const visiveisIds = visiveis.map((t) => t.id);
  const todasVisiveis = visiveisIds.length > 0 && visiveisIds.every((id) => sel.includes(id));
  const algumaVisivel = visiveisIds.some((id) => sel.includes(id));
  const alternar = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selecionadas = todas.filter((t) => sel.includes(t.id));
  const usoSelecionadas = selecionadas.reduce((a, t) => a + (t._count?.conversations ?? 0), 0);

  async function emMassa(data: { color?: string; isKanban?: boolean; showOnClose?: boolean }, ok: string) {
    try {
      const r = await bulkUpdate.mutateAsync({ ids: sel, ...data });
      toast.ok(`${r.updated} tag(s) ${ok}`);
    } catch (err) { toast.err(err); }
  }

  async function criarLote(e: React.FormEvent) {
    e.preventDefault();
    if (!lote) return;
    if (!novosDoLote.length) return;
    try {
      const r = await bulkCreate.mutateAsync({ items: novosDoLote.map((name) => ({ name, color: lote.cores[name] ?? lote.color })), color: lote.color, isKanban: lote.isKanban, showOnClose: lote.showOnClose });
      toast.ok(r.skipped ? `${r.created} criada(s) · ${r.skipped} já existiam` : `${r.created} tag(s) criada(s)`);
      setLote(null);
    } catch (err) { toast.err(err); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing?.name) return;
    try {
      if (editing.id) await update.mutateAsync({ id: editing.id, name: editing.name, color: editing.color, isKanban: editing.isKanban, showOnClose: editing.showOnClose });
      else await create.mutateAsync({ name: editing.name, color: editing.color ?? PALETTE[0], isKanban: editing.isKanban ?? true, showOnClose: editing.showOnClose ?? false });
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
        subtitle="Classifique conversas durante o atendimento. As tags viram filtros, relatórios e — marcadas como etapa — colunas do Kanban."
        action={isAdmin && (
          <div className="flex gap-2">
            <Button variant="ghost" icon={<ListPlus size={16} />} onClick={() => setLote({ nomes: '', color: PALETTE[0], isKanban: false, showOnClose: false, cores: {} })}>Criar várias</Button>
            <Button onClick={() => setEditing({ color: PALETTE[Math.floor(Math.random() * PALETTE.length)] })} icon={<Plus size={16} />}>Nova tag</Button>
          </div>
        )}
      />

      {todas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tag…" className={cn(inputCls, 'sm:w-64 py-1.5')} aria-label="Buscar tag" />
          <div className="flex flex-wrap gap-1">
            {FILTROS.map((f) => {
              const n = todas.filter(f.match).length;
              return (
                <button key={f.id} type="button" onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id} className={cn('rounded-full px-2.5 py-1 text-xs font-medium border', filtro === f.id ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:text-ink')}>
                  {f.label} <span className="tnum opacity-70">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* barra de seleção: o "selecionar todos" vale para o que está na tela (busca + filtro) */}
      {isAdmin && visiveis.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 mb-3 rounded-xl border border-line bg-panel px-4 py-2 text-xs">
          <input type="checkbox" aria-label="Selecionar todas as tags da lista" checked={todasVisiveis} ref={(el) => { if (el) el.indeterminate = algumaVisivel && !todasVisiveis; }} onChange={() => setSel((s) => (todasVisiveis ? s.filter((id) => !visiveisIds.includes(id)) : [...new Set([...s, ...visiveisIds])]))} />
          <span className="text-muted flex-1 min-w-[8rem]">{sel.length ? `${sel.length} selecionada(s)` : `Selecionar todas (${visiveis.length})`}</span>
          {sel.length > 0 && (
            <>
              <Button size="sm" variant="ghost" icon={<CheckCircle2 size={13} />} disabled={bulkUpdate.isPending} onClick={() => emMassa({ showOnClose: true }, 'no encerramento')}>Mostrar no encerramento</Button>
              <Button size="sm" variant="ghost" disabled={bulkUpdate.isPending} onClick={() => emMassa({ showOnClose: false }, 'fora do encerramento')}>Tirar do encerramento</Button>
              <Button size="sm" variant="ghost" icon={<Columns3 size={13} />} disabled={bulkUpdate.isPending} onClick={() => emMassa({ isKanban: true }, 'no Kanban')}>Pôr no Kanban</Button>
              <Button size="sm" variant="ghost" disabled={bulkUpdate.isPending} onClick={() => emMassa({ isKanban: false }, 'fora do Kanban')}>Tirar do Kanban</Button>
              <div className="relative">
                <Button size="sm" variant="ghost" icon={<Palette size={13} />} disabled={bulkUpdate.isPending} onClick={() => setPaleta((p) => !p)}>Cor</Button>
                {paleta && <ColorPopover align="right" onClose={() => setPaleta(false)} onPick={(c) => { setPaleta(false); void emMassa({ color: c }, 'com a nova cor'); }} />}
              </div>
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} className="text-danger" onClick={() => setExcluindoLote(true)}>Excluir</Button>
              <button type="button" onClick={() => setSel([])} className="p-1 text-faint hover:text-ink" title="Limpar seleção"><X size={14} /></button>
            </>
          )}
        </div>
      )}

      {tags.isLoading && <SkeletonRows rows={4} />}
      {tags.data?.length === 0 && <Empty icon={<TagIcon size={36} />} title="Nenhuma tag" text='Crie tags como "lead com interesse" ou "comprador recorrente".' />}

      {todas.length > 0 && visiveis.length === 0 && <p className="rounded-2xl border border-dashed border-line px-5 py-4 text-sm text-faint">Nenhuma tag com esse filtro.</p>}

      {visiveis.length > 0 && (
        <div className="rounded-2xl bg-panel border border-line divide-y divide-line">
          <div className="flex items-end gap-3 px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">
            {isAdmin && <span className="w-4 shrink-0" />}
            <span className="flex-1">Tag</span>
            <span className="w-32 shrink-0 text-center leading-tight">
              Aparece no encerramento
              <span className="block normal-case tracking-normal font-normal">Comprou / Não comprou</span>
            </span>
            {isAdmin && <span className="w-[54px] shrink-0" />}
          </div>
          {visiveis.map((t) => (
            <div key={t.id} className={cn('flex items-center gap-3 px-5 py-3', sel.includes(t.id) && 'bg-accent-soft/40')}>
              {isAdmin && <input type="checkbox" className="shrink-0" aria-label={`Selecionar ${t.name}`} checked={sel.includes(t.id)} onChange={() => alternar(t.id)} />}
              {isAdmin ? (
                <div className="relative shrink-0">
                  <button type="button" onClick={() => setCorDe(corDe === t.id ? null : t.id)} title="Trocar a cor" aria-label={`Trocar a cor de ${t.name}`} className="w-4 h-4 rounded-full block ring-offset-2 hover:ring-2 hover:ring-line" style={{ background: t.color }} />
                  {corDe === t.id && (
                    <ColorPopover value={t.color} onClose={() => setCorDe(null)} onPick={(c) => { setCorDe(null); update.mutateAsync({ id: t.id, color: c }).catch(toast.err); }} />
                  )}
                </div>
              ) : <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: t.color }} />}
              <span className="flex-1 font-medium text-sm">{t.name}</span>
              {t.isKanban !== false && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted bg-field rounded-md px-1.5 py-0.5" title="Aparece como coluna no Kanban"><Columns3 size={11} />Kanban</span>}
              <span className="text-xs text-faint tnum">{t._count?.conversations ?? 0} conversa{(t._count?.conversations ?? 0) === 1 ? '' : 's'} · 📌 {t._count?.contacts ?? 0} contato{(t._count?.contacts ?? 0) === 1 ? '' : 's'}</span>
              {/* coluna própria com título no cabeçalho: como selo solto ao lado do nome, ninguém
                  entendia que era para ligar a tag no encerramento */}
              <div className="w-32 shrink-0 flex justify-center">
                {isAdmin ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!t.showOnClose}
                    aria-label={`Mostrar "${t.name}" ao encerrar o atendimento`}
                    disabled={update.isPending && update.variables?.id === t.id}
                    onClick={() => update.mutateAsync({ id: t.id, showOnClose: !t.showOnClose }).catch(toast.err)}
                    title={t.showOnClose ? 'Aparece ao encerrar (Comprou / Não comprou). Clique para tirar.' : 'Clique para aparecer ao encerrar (Comprou / Não comprou)'}
                    className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${t.showOnClose ? 'bg-ok' : 'bg-line'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${t.showOnClose ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                ) : t.showOnClose ? <CheckCircle2 size={15} className="text-ok" aria-label="Aparece no encerramento" /> : <span className="text-faint">—</span>}
              </div>
              {isAdmin && (
                <>
                  <button onClick={() => setEditing(t)} className="text-faint hover:text-ink p-1" title="Editar"><Pencil size={15} /></button>
                  <button onClick={() => setDeleting(t)} className="text-faint hover:text-danger p-1" title="Excluir"><Trash2 size={15} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar tag' : 'Nova tag'} width="max-w-sm">
        <form onSubmit={save} className="space-y-4">
          <Field label="Nome"><input className={inputCls} value={editing?.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={40} required autoFocus /></Field>
          {/* div, não Field: o Field é <label>, e clicar no título acionava a 1ª cor da paleta */}
          <div className="text-sm space-y-1">
            <span className="text-ink font-medium">Cor</span>
            <ColorSwatches value={editing?.color} onChange={(c) => setEditing({ ...editing, color: c })} />
          </div>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={editing?.isKanban ?? true} onChange={(e) => setEditing({ ...editing, isKanban: e.target.checked })} />
            <span>
              <span className="text-ink font-medium">Etapa no Kanban</span>
              <span className="block text-xs text-faint">Vira uma coluna do quadro. Desmarcar tira os atendimentos dessa etapa (a tag continua neles).</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={editing?.showOnClose ?? false} onChange={(e) => setEditing({ ...editing, showOnClose: e.target.checked })} />
            <span>
              <span className="text-ink font-medium">Exibir no encerramento (Comprou / Não comprou)</span>
              <span className="block text-xs text-faint">Só as marcadas aparecem para escolha ao encerrar — tag interna ou operacional fica de fora.</span>
            </span>
          </label>
          <div className="flex items-center gap-2 text-sm text-muted">
            Prévia: <span className="text-[11px] text-white rounded px-1.5 py-0.5" style={{ background: editing?.color }}>{editing?.name || 'nome da tag'}</span>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button type="submit" loading={create.isPending || update.isPending} loadingText="Salvando…">Salvar</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!lote} onClose={() => setLote(null)} title="Criar várias tags" width="max-w-lg">
        {lote && (
          <form onSubmit={criarLote} className="space-y-4">
            <Field label="Nomes" hint="Uma por linha (ou separadas por ;). Até 40 caracteres cada; as que já existem são ignoradas.">
              <textarea className={cn(inputCls, 'resize-none font-mono text-[13px]')} rows={5} autoFocus value={lote.nomes} onChange={(e) => setLote({ ...lote, nomes: e.target.value })} placeholder={'Achou caro\nNão respondeu\nVai vir na loja'} />
            </Field>
            {/* div, não Field: o Field é <label>, e clicar no título acionava a 1ª cor da paleta */}
            <div className="text-sm space-y-1">
              <span className="text-ink font-medium">Cor padrão</span>
              <ColorSwatches value={lote.color} onChange={(c) => setLote({ ...lote, color: c })} />
              <span className="block text-xs text-faint">Vale para as que você não coloriu uma a uma.</span>
            </div>
            {nomesDoLote.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">Cor de cada uma</span>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setLote({ ...lote, cores: Object.fromEntries(novosDoLote.map((n, i) => [n, PALETTE[i % PALETTE.length]])) })} className="text-[12px] text-muted underline hover:text-ink">Variar cores</button>
                    {Object.keys(lote.cores).length > 0 && <button type="button" onClick={() => setLote({ ...lote, cores: {} })} className="text-[12px] text-muted underline hover:text-ink">Todas na cor padrão</button>}
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-line divide-y divide-line">
                  {nomesDoLote.map((n) => {
                    const ja = existentes.has(n.toLowerCase());
                    const cor = lote.cores[n] ?? lote.color;
                    return (
                      // paleta sempre à vista na linha: um clique escolhe a cor desta tag
                      <div key={n} className={cn('px-3 py-2 space-y-1', ja && 'opacity-50')}>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-white rounded px-1.5 py-0.5 truncate" style={{ background: cor }}>{n}</span>
                          {ja && <span className="ml-auto text-[11px] text-faint shrink-0">já existe — não será criada</span>}
                        </div>
                        {!ja && <ColorSwatches size="w-5 h-5" value={cor} onChange={(c) => setLote({ ...lote, cores: { ...lote.cores, [n]: c } })} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={lote.showOnClose} onChange={(e) => setLote({ ...lote, showOnClose: e.target.checked })} /> Aparecem no encerramento (Comprou / Não comprou)</label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={lote.isKanban} onChange={(e) => setLote({ ...lote, isKanban: e.target.checked })} /> Viram etapas do Kanban</label>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setLote(null)}>Cancelar</Button>
              <Button type="submit" loading={bulkCreate.isPending} loadingText="Criando…" disabled={!novosDoLote.length}>Criar {novosDoLote.length || ''}</Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={excluindoLote}
        onClose={() => setExcluindoLote(false)}
        title={`Excluir ${sel.length} tag(s)`}
        danger
        confirmLabel={`Excluir ${sel.length}`}
        text={`${selecionadas.slice(0, 5).map((t) => `"${t.name}"`).join(', ')}${selecionadas.length > 5 ? ` e mais ${selecionadas.length - 5}` : ''} serão removidas${usoSelecionadas ? ` de ${usoSelecionadas} conversa(s)` : ''}. Relatórios antigos deixam de contá-las.`}
        onConfirm={async () => { try { const r = await bulkDelete.mutateAsync(sel); setSel([]); toast.ok(`${r.deleted} tag(s) excluída(s)`); } catch (err) { toast.err(err); throw err; } }}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir tag"
        danger
        confirmLabel="Excluir"
        text={`A tag "${deleting?.name}" será removida de ${deleting?._count?.conversations ?? 0} conversa(s). Relatórios antigos deixam de contá-la.`}
        onConfirm={async () => { if (!deleting) return; try { await remove.mutateAsync(deleting.id); toast.ok('Tag excluída'); } catch (err) { toast.err(err); throw err; } }}
      />
    </PageShell>
  );
}
