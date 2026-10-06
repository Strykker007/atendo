'use client';
import { useState } from 'react';
import { Building, Plus } from 'lucide-react';
import { GLOBAL_VARIABLE_KEY_MAX, GLOBAL_VARIABLE_VALUE_MAX, globalVarKey, globalVarKeyError } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useCan, useCreateGlobalVariable, useGlobalVariables, useUpdateGlobalVariable, type GlobalVariable } from '@/lib/hooks';

/**
 * Formulário da variável da empresa (docs/variaveis.md). Sem `<form>` de propósito: aparece
 * dentro do menu "Inserir variável", que muitas vezes já está dentro de um formulário (resposta
 * rápida, agendamento) — Enter num campo daqui não pode enviar o de fora.
 */
export function GlobalVariableForm({ initial, onSaved, onCancel, compact }: { initial?: GlobalVariable; onSaved: (v: GlobalVariable) => void; onCancel: () => void; compact?: boolean }) {
  const create = useCreateGlobalVariable();
  const update = useUpdateGlobalVariable();
  const [label, setLabel] = useState(initial?.label ?? '');
  const [value, setValue] = useState(initial?.value ?? '');
  const [key, setKey] = useState(initial?.key ?? '');
  // a chave acompanha o nome até a pessoa mexer nela (ou ao editar uma que já existe)
  const [keyTouched, setKeyTouched] = useState(!!initial);
  const effectiveKey = keyTouched ? key : globalVarKey(label);
  const keyError = effectiveKey ? globalVarKeyError(effectiveKey) : null;
  const saving = create.isPending || update.isPending;
  const keyChanged = !!initial && effectiveKey !== initial.key;

  async function save() {
    if (!label.trim() || !effectiveKey || keyError || saving) return;
    try {
      const body = { label: label.trim(), key: effectiveKey, value };
      const v = initial ? await update.mutateAsync({ id: initial.id, ...body }) : await create.mutateAsync(body);
      toast.ok(initial ? 'Variável atualizada' : `Variável {{${v.key}}} criada`);
      onSaved(v);
    } catch (e) {
      toast.err(e);
    }
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); void save(); }
  };
  const lbl = compact ? 'block text-[11px] font-medium text-muted mb-0.5' : 'block text-sm font-medium text-ink mb-1';

  return (
    <div className="space-y-2" onKeyDown={onKey}>
      <label className="block">
        <span className={lbl}>Nome</span>
        <input className={cn(inputCls, compact && 'py-1.5')} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Chave PIX da loja" autoFocus />
      </label>
      <label className="block">
        <span className={lbl}>Chave da variável</span>
        <div className="flex items-center gap-1 font-mono text-[12px] text-muted">
          <span>{'{{'}</span>
          <input className={cn(inputCls, 'font-mono', compact && 'py-1.5')} value={effectiveKey} onChange={(e) => { setKeyTouched(true); setKey(e.target.value.toLowerCase().replace(/\s+/g, '_')); }} maxLength={GLOBAL_VARIABLE_KEY_MAX} placeholder="pix_chave" />
          <span>{'}}'}</span>
        </div>
        {keyError && <span className="block text-[11px] text-danger mt-0.5">{keyError}</span>}
        {keyChanged && !keyError && <span className="block text-[11px] text-warn-ink mt-0.5">Textos que já usam {`{{${initial!.key}}}`} deixam de ser trocados.</span>}
      </label>
      <label className="block">
        <span className={lbl}>Valor</span>
        <textarea className={cn(inputCls, 'min-h-16', compact && 'py-1.5')} value={value} onChange={(e) => setValue(e.target.value)} maxLength={GLOBAL_VARIABLE_VALUE_MAX} placeholder="financeiro@loja.com.br" />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button type="button" size="sm" onClick={() => void save()} loading={saving} disabled={!label.trim() || !effectiveKey || !!keyError}>{initial ? 'Salvar' : compact ? 'Criar e inserir' : 'Criar'}</Button>
      </div>
    </div>
  );
}

/**
 * Grupo "Variáveis da empresa" dos menus de variável (fluxos, respostas rápidas, chat), com o
 * "+ Criar nova variável global" ali mesmo: criou, já entra no texto.
 */
export function GlobalVarsMenuSection({ onPick, keyFirst }: { onPick: (key: string) => void; /** chave em cima (menu dos fluxos) ou nome em cima (chat) */ keyFirst?: boolean }) {
  const vars = useGlobalVariables().data ?? [];
  // quem edita fluxos também cria aqui (editar/excluir fica em Configurações, com `variables.manage`)
  const canManage = useCan('variables.manage');
  const canFlows = useCan('flows.manage');
  const canCreate = canManage || canFlows;
  const [creating, setCreating] = useState(false);
  if (!vars.length && !canCreate) return null;
  return (
    <div>
      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Variáveis da empresa</div>
      {vars.map((v) => (
        <button type="button" key={v.id} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(v.key)} className="w-full text-left px-3 py-1.5 hover:bg-field" title={v.value}>
          {keyFirst ? (
            <>
              <div className="font-mono text-[12px] text-ink">{`{{${v.key}}}`}</div>
              <div className="text-[11px] text-muted truncate">{v.label} · {v.value || <i>vazio</i>}</div>
            </>
          ) : (
            <>
              <div className="text-[13px] text-ink">{v.label}</div>
              <div className="font-mono text-[11px] text-muted">{`{{${v.key}}}`}</div>
            </>
          )}
        </button>
      ))}
      {canCreate && !creating && (
        <button type="button" onClick={() => setCreating(true)} className="w-full flex items-center gap-1.5 text-left px-3 py-1.5 text-[12px] font-semibold text-accent-ink hover:bg-field">
          <Plus size={13} /> Criar nova variável global
        </button>
      )}
      {creating && (
        <div className="mx-2 my-1 rounded-lg border border-line bg-field/40 p-2.5">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink mb-2"><Building size={13} /> Nova variável da empresa</div>
          <GlobalVariableForm compact onCancel={() => setCreating(false)} onSaved={(v) => { setCreating(false); onPick(v.key); }} />
        </div>
      )}
    </div>
  );
}
