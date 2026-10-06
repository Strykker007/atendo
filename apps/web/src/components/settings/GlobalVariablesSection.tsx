'use client';
import { useState } from 'react';
import { Copy, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Modal, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { GlobalVariableForm } from '@/components/variables/GlobalVariables';
import { useDeleteGlobalVariable, useGlobalVariables, type GlobalVariable } from '@/lib/hooks';

/**
 * Variáveis da empresa: valores fixos (chave PIX, horário, link do catálogo) usados em fluxos,
 * respostas rápidas, campanhas e no chat como `{{chave}}`. Ver docs/variaveis.md.
 */
export function GlobalVariablesSection() {
  const vars = useGlobalVariables();
  const remove = useDeleteGlobalVariable();
  const [q, setQ] = useState('');
  // `null` fechado, `new` nova, variável = editando
  const [editing, setEditing] = useState<GlobalVariable | 'new' | null>(null);
  const [deleting, setDeleting] = useState<GlobalVariable | null>(null);
  const lista = vars.data ?? [];
  const termo = q.trim().toLowerCase();
  const filtradas = termo ? lista.filter((v) => `${v.label} ${v.key} ${v.value}`.toLowerCase().includes(termo)) : lista;

  const copiar = (key: string) => navigator.clipboard.writeText(`{{${key}}}`).then(() => toast.ok(`{{${key}}} copiada`)).catch(toast.err);

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-semibold text-ink">Variáveis globais</h2>
          <p className="text-sm text-muted">
            Valores da empresa que você repete nas mensagens — chave PIX, horário, link do catálogo. Use <code className="font-mono text-ink">{'{{chave}}'}</code> em
            fluxos, respostas rápidas, campanhas e no chat: mudou aqui, muda em todo lugar no próximo envio.
          </p>
        </div>
        <Button onClick={() => setEditing('new')} icon={<Plus size={16} />}>Nova variável</Button>
      </div>

      {lista.length > 5 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className={`${inputCls} pl-8`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, chave ou valor" />
        </div>
      )}

      {vars.isLoading && <div className="h-12 rounded-lg bg-field animate-pulse" />}
      {!vars.isLoading && lista.length === 0 && <p className="text-sm text-muted rounded-lg bg-field px-3 py-3">Nenhuma variável ainda. Ex.: “Chave PIX” → <code className="font-mono">{'{{chave_pix}}'}</code>.</p>}
      {!!lista.length && filtradas.length === 0 && <p className="text-sm text-muted px-1">Nada encontrado para “{q}”.</p>}

      {!!filtradas.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-line">
                <th className="py-2 pr-3 font-semibold">Nome</th>
                <th className="py-2 pr-3 font-semibold">Variável</th>
                <th className="py-2 pr-3 font-semibold">Valor</th>
                <th className="py-2 w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtradas.map((v) => (
                <tr key={v.id}>
                  <td className="py-2.5 pr-3 font-medium text-ink">{v.label}</td>
                  <td className="py-2.5 pr-3">
                    <button type="button" onClick={() => copiar(v.key)} title="Copiar" className="inline-flex items-center gap-1 font-mono text-[12px] text-accent-ink hover:underline">
                      {`{{${v.key}}}`} <Copy size={11} />
                    </button>
                  </td>
                  <td className="py-2.5 pr-3 text-muted max-w-xs truncate" title={v.value}>{v.value || <i className="text-faint">vazio</i>}</td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(v)} className="text-faint hover:text-ink p-1" title="Editar"><Pencil size={15} /></button>
                    <button onClick={() => setDeleting(v)} className="text-faint hover:text-danger p-1" title="Excluir"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? 'Editar variável' : 'Nova variável global'} width="max-w-md">
        {editing && <GlobalVariableForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSaved={() => setEditing(null)} />}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Excluir variável"
        text={`Excluir {{${deleting?.key}}}? Textos que a usam passam a enviar vazio no lugar dela (no chat, o texto fica como foi escrito).`}
        confirmLabel="Excluir"
        danger
        onConfirm={() => remove.mutateAsync(deleting!.id).then(() => { toast.ok('Variável excluída'); setDeleting(null); }).catch(toast.err)}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}
