'use client';
import { useEffect, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Check, GripVertical, Pencil, Plus, RotateCcw, Trash2, X, XCircle } from 'lucide-react';
import { DEFAULT_LOSS_REASONS, LOSS_REASONS_MAX } from '@atendo/shared';
import { inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { useTenantSettings, useUpdateTenantSettings } from '@/lib/hooks';

const igual = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Motivos sugeridos no encerramento "Não comprou". O relatório "Motivos de perda" agrupa
 * pelo texto, então lista curta e fixa rende mais que cada atendente escrevendo do seu jeito.
 * Remover ou renomear um motivo não mexe no histórico: os encerramentos antigos continuam com
 * o texto deles.
 *
 * Lista ordenável (é a ordem dos chips no encerramento), edição na própria linha e colar várias
 * linhas de uma vez — antes eram chips soltos com um X, sem ordem nem como corrigir um erro de
 * digitação sem apagar e recriar.
 */
export function LossReasonsSection() {
  const settings = useTenantSettings();
  const update = useUpdateTenantSettings();
  // espelho local: arrastar/editar aparece na hora, sem esperar a volta da API
  const [lista, setLista] = useState<string[]>([]);
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState<{ i: number; texto: string } | null>(null);
  const [removendo, setRemovendo] = useState<number | null>(null);
  const [restaurar, setRestaurar] = useState(false);
  const novoRef = useRef<HTMLInputElement>(null);

  const doServidor = settings.data?.lossReasons;
  useEffect(() => { if (doServidor) setLista(doServidor); }, [doServidor]);
  if (!settings.data) return null;

  const cheio = lista.length >= LOSS_REASONS_MAX;

  /** Grava a lista; se a API recusar, volta ao que estava. */
  function salvar(proxima: string[], ok?: string) {
    const antes = lista;
    setLista(proxima);
    return update.mutateAsync({ lossReasons: proxima })
      .then(() => { if (ok) toast.ok(ok); })
      .catch((err) => { setLista(antes); toast.err(err); throw err; });
  }

  /** Aceita um motivo ou vários (uma linha cada — colar de uma planilha funciona). */
  function adicionar(texto: string) {
    const itens = texto.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
    if (!itens.length) return;
    const proxima = [...lista];
    let repetidos = 0;
    for (const m of itens) {
      if (proxima.some((x) => igual(x, m))) { repetidos++; continue; }
      if (proxima.length >= LOSS_REASONS_MAX) break;
      proxima.push(m.slice(0, 200));
    }
    const entraram = proxima.length - lista.length;
    if (!entraram) return toast.err(new Error(repetidos ? 'Esse motivo já existe' : `Limite de ${LOSS_REASONS_MAX} motivos`));
    const sobra = itens.length - entraram - repetidos;
    salvar(proxima, entraram === 1 ? 'Motivo adicionado' : `${entraram} motivos adicionados`)
      .then(() => {
        setNovo('');
        if (repetidos) toast.warn(`${repetidos} já existia${repetidos > 1 ? 'm' : ''} e ficou de fora.`);
        if (sobra > 0) toast.warn(`${sobra} não couberam: o limite é ${LOSS_REASONS_MAX}.`);
        novoRef.current?.focus();
      })
      .catch(() => undefined);
  }

  function confirmarEdicao() {
    if (!editando) return;
    const texto = editando.texto.trim();
    if (!texto || texto === lista[editando.i]) return setEditando(null);
    if (lista.some((x, j) => j !== editando.i && igual(x, texto))) return toast.err(new Error('Esse motivo já existe'));
    salvar(lista.map((x, j) => (j === editando.i ? texto : x)), 'Motivo renomeado').then(() => setEditando(null)).catch(() => undefined);
  }

  function soltar(r: DropResult) {
    if (!r.destination || r.destination.index === r.source.index) return;
    const proxima = [...lista];
    const [item] = proxima.splice(r.source.index, 1);
    proxima.splice(r.destination.index, 0, item);
    salvar(proxima).catch(() => undefined);
  }

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-semibold text-ink flex items-center gap-2"><XCircle size={16} /> Motivos de perda</h3>
          <p className="text-sm text-muted mt-0.5">Aparecem para um clique ao encerrar como &quot;Não comprou&quot;, nesta ordem, e formam o gráfico de Motivos de perda em Relatórios. O atendente ainda pode escrever outro.</p>
        </div>
        <span className={cn('shrink-0 text-[11px] font-medium rounded-full px-2 py-0.5 tnum', cheio ? 'bg-warn-soft text-warn-ink' : 'bg-field text-muted')}>{lista.length} de {LOSS_REASONS_MAX}</span>
      </div>

      <div className="rounded-xl border border-line overflow-hidden">
        {lista.length === 0 && (
          <div className="px-4 py-6 text-center text-[13px] text-faint">
            Nenhum motivo cadastrado. Adicione abaixo ou{' '}
            <button type="button" className="text-accent-ink underline" onClick={() => salvar([...DEFAULT_LOSS_REASONS], 'Motivos padrão restaurados').catch(() => undefined)}>use a lista padrão</button>.
          </div>
        )}
        <DragDropContext onDragEnd={soltar}>
          <Droppable droppableId="motivos">
            {(dp) => (
              <ul ref={dp.innerRef} {...dp.droppableProps} className="divide-y divide-line">
                {lista.map((m, i) => (
                  <Draggable key={m} draggableId={m} index={i} isDragDisabled={!!editando || update.isPending}>
                    {(dr, ds) => (
                      <li ref={dr.innerRef} {...dr.draggableProps} className={cn('group flex items-center gap-2 px-3 h-11 bg-panel', ds.isDragging && 'shadow-lg rounded-lg ring-1 ring-line')}>
                        <span {...dr.dragHandleProps} className="text-faint hover:text-ink cursor-grab shrink-0" title="Arraste para reordenar"><GripVertical size={15} /></span>
                        <span className="w-5 text-right text-[11px] text-faint tnum shrink-0">{i + 1}</span>
                        {editando?.i === i ? (
                          <>
                            <input
                              autoFocus
                              className={cn(inputCls, 'h-8 py-0 flex-1 min-w-0')}
                              value={editando.texto}
                              maxLength={200}
                              onChange={(e) => setEditando({ i, texto: e.target.value })}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarEdicao(); } if (e.key === 'Escape') setEditando(null); }}
                            />
                            <button type="button" title="Salvar (Enter)" onClick={confirmarEdicao} className="p-1.5 rounded-md text-ok hover:bg-ok-soft"><Check size={15} /></button>
                            <button type="button" title="Cancelar (Esc)" onClick={() => setEditando(null)} className="p-1.5 rounded-md text-faint hover:text-ink hover:bg-field"><X size={15} /></button>
                          </>
                        ) : removendo === i ? (
                          <>
                            <span className="flex-1 min-w-0 truncate text-[13px] text-ink">Remover <b>{m}</b>?</span>
                            <Button size="sm" variant="danger" loading={update.isPending} onClick={() => salvar(lista.filter((_, j) => j !== i), 'Motivo removido').then(() => setRemovendo(null)).catch(() => undefined)}>Remover</Button>
                            <Button size="sm" variant="ghost" onClick={() => setRemovendo(null)}>Cancelar</Button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => { setRemovendo(null); setEditando({ i, texto: m }); }} className="flex-1 min-w-0 truncate text-left text-[13px] text-ink" title="Clique para renomear">{m}</button>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                              <button type="button" title="Renomear" onClick={() => { setRemovendo(null); setEditando({ i, texto: m }); }} className="p-1.5 rounded-md text-faint hover:text-ink hover:bg-field"><Pencil size={14} /></button>
                              <button type="button" title="Remover" onClick={() => { setEditando(null); setRemovendo(i); }} className="p-1.5 rounded-md text-faint hover:text-danger hover:bg-danger-soft"><Trash2 size={14} /></button>
                            </div>
                          </>
                        )}
                      </li>
                    )}
                  </Draggable>
                ))}
                {dp.placeholder}
              </ul>
            )}
          </Droppable>
        </DragDropContext>

        <form onSubmit={(e) => { e.preventDefault(); adicionar(novo); }} className={cn('flex items-center gap-2 px-3 py-2 bg-field/50', lista.length > 0 && 'border-t border-line')}>
          <Plus size={15} className="text-faint shrink-0 ml-0.5" />
          <input
            ref={novoRef}
            className="flex-1 min-w-0 bg-transparent text-[13px] text-ink placeholder:text-faint focus:outline-none h-8"
            placeholder={cheio ? `Limite de ${LOSS_REASONS_MAX} motivos atingido` : 'Novo motivo — Enter para adicionar (cole vários, um por linha)'}
            value={novo}
            maxLength={2000}
            onChange={(e) => setNovo(e.target.value)}
            // colar várias linhas: o input de uma linha engoliria as quebras, então trata aqui
            onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/\r?\n/.test(t.trim())) { e.preventDefault(); adicionar(t); } }}
            disabled={cheio}
          />
          <Button type="submit" size="sm" loading={update.isPending && !editando && removendo === null} disabled={!novo.trim() || cheio}>Adicionar</Button>
        </form>
      </div>

      <div className="flex items-center justify-between gap-3 text-[11.5px] text-faint">
        <span>Renomear ou remover não altera encerramentos antigos.</span>
        <button type="button" onClick={() => setRestaurar(true)} className="inline-flex items-center gap-1 hover:text-ink shrink-0"><RotateCcw size={12} /> Restaurar padrão</button>
      </div>

      <ConfirmDialog
        open={restaurar}
        onClose={() => setRestaurar(false)}
        title="Restaurar motivos padrão"
        confirmLabel="Restaurar"
        text={`A lista atual é substituída por: ${DEFAULT_LOSS_REASONS.join(', ')}. Encerramentos antigos não mudam.`}
        onConfirm={() => salvar([...DEFAULT_LOSS_REASONS], 'Motivos padrão restaurados')}
      />
    </section>
  );
}
