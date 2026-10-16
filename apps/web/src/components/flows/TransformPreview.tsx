'use client';
import { useState } from 'react';
import { Play } from 'lucide-react';
import type { VariableAssignment, VariableOp } from '@atendo/shared';
import { VARIABLE_OP_LABEL } from '@atendo/shared';
import { inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { useTransformPreview } from '@/lib/hooks/fluxos';

/** Seletor de operação agrupado: com 20+ opções numa lista só, ninguém achava as de tratar dados. */
const OP_GROUPS: { label: string; ops: VariableOp[] }[] = [
  { label: 'Básico', ops: ['set', 'add', 'subtract', 'append', 'clear', 'copy', 'now'] },
  { label: 'Texto', ops: ['upper', 'lower', 'trim', 'replace', 'extract', 'slice'] },
  { label: 'Número', ops: ['to_number', 'round', 'currency', 'expression'] },
  { label: 'JSON (resposta de API)', ops: ['json_path', 'list_count'] },
  { label: 'Data', ops: ['date_format', 'date_add', 'date_diff'] },
];
/** No "Tratar dados" o Básico fica de fora: é o Manipulador de sempre. */
export function OpOptions({ transform }: { transform?: boolean }) {
  return <>{OP_GROUPS.filter((g) => !transform || g.label !== 'Básico').map((g) => (
    <optgroup key={g.label} label={g.label}>{g.ops.map((o) => <option key={o} value={o}>{VARIABLE_OP_LABEL[o].replace(/^[^:]+: /, '')}</option>)}</optgroup>
  ))}</>;
}

/** Variáveis `{{x}}` usadas nas operações que não são criadas por elas: as que precisam de valor de exemplo. */
function inputsOf(list: VariableAssignment[]) {
  const created = new Set<string>();
  const needed: string[] = [];
  for (const a of list) {
    const text = [a.value, a.pattern, a.replacement, a.start, a.length, a.decimals, a.path, a.days, a.otherDate].join(' ');
    for (const [, k] of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) if (!created.has(k) && !k.startsWith('contact.') && !needed.includes(k)) needed.push(k);
    if (a.op === 'copy' && a.from && !created.has(a.from) && !a.from.startsWith('contact.') && !needed.includes(a.from)) needed.push(a.from);
    if (a.varName) created.add(a.varName);
  }
  return needed;
}

/** Prévia: roda as operações no servidor (o mesmo código do motor) com valores de exemplo. Não grava nada. */
export function TransformPreview({ assignments }: { assignments: VariableAssignment[] }) {
  const [sample, setSample] = useState<Record<string, string>>({});
  const preview = useTransformPreview();
  const needed = inputsOf(assignments);
  const outputs = [...new Set(assignments.map((a) => a.varName).filter(Boolean))];
  const run = () => preview.mutate({ assignments, vars: Object.fromEntries(needed.map((k) => [k, sample[k] ?? ''])) });
  return (
    <div className="min-w-0 rounded-lg border border-line p-2 space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Testar com valores de exemplo</div>
      {needed.length === 0 && <p className="text-[11px] text-muted">Use {'{{variável}}'} na entrada para testar com um valor de exemplo.</p>}
      {needed.map((k) => (
        <label key={k} className="block min-w-0">
          <span className="text-[11px] font-mono text-muted break-all">{`{{${k}}}`}</span>
          <textarea rows={k.toLowerCase().includes('resposta') || k.toLowerCase().includes('json') ? 3 : 1} className={`${inputCls} min-w-0 w-full font-mono text-[12px]`} value={sample[k] ?? ''} placeholder={'ex.: {"cliente":{"nome":"Ana"}} ou 123.456.789-00'} onChange={(e) => setSample((s) => ({ ...s, [k]: e.target.value }))} />
        </label>
      ))}
      <Button size="sm" variant="ghost" icon={<Play size={12} />} onClick={run} disabled={preview.isPending || outputs.length === 0}>{preview.isPending ? 'Calculando…' : 'Ver resultado'}</Button>
      {preview.error && <p className="text-[11px] text-danger">{preview.error instanceof ApiError ? preview.error.message : 'Não deu para calcular a prévia.'}</p>}
      {preview.data && (
        <div className="space-y-1">
          {outputs.map((k) => (
            <div key={k} className="min-w-0 rounded bg-field px-2 py-1">
              <span className="text-[11px] font-mono text-muted">{`{{${k}}}`} =</span>
              <pre className="text-[12px] text-ink whitespace-pre-wrap break-all max-h-32 overflow-auto">{preview.data.vars[k] === '' || preview.data.vars[k] === undefined ? '(vazio)' : preview.data.vars[k]}</pre>
            </div>
          ))}
          {preview.data.problems.map((p, i) => <p key={i} className="text-[11px] text-danger">{p}</p>)}
        </div>
      )}
    </div>
  );
}
