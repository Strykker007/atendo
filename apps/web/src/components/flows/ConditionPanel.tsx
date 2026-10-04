'use client';
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useTags } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { TextWithVars, type FlowVar } from './TextWithVars';
import { newBranch, newRule } from './nodes';
import {
  CONDITION_CONTACT_FIELD_LABEL, CONDITION_OPERANDS, CONDITION_OPS,
  type ConditionBranch, type ConditionOperand, type ConditionRule,
} from '@atendo/shared';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const NUMERIC = new Set(['num_eq', 'num_neq', 'gt', 'gte', 'lt', 'lte']);

/** Dias da semana (0 = domingo) como botões liga/desliga. */
function DaysPicker({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {WEEKDAYS.map((l, i) => {
        const on = days.includes(i);
        return <button key={i} type="button" onClick={() => onChange(on ? days.filter((d) => d !== i) : [...days, i].sort())} className={cn('w-7 h-7 rounded-md text-xs font-semibold', on ? 'bg-accent text-white' : 'bg-field text-muted')}>{l}</button>;
      })}
    </div>
  );
}

function TimeRange({ from, to, onChange }: { from?: string; to?: string; onChange: (p: { from?: string; to?: string }) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Das"><input type="time" className={inputCls} value={from ?? ''} onChange={(e) => onChange({ from: e.target.value })} /></Field>
      <Field label="Até"><input type="time" className={inputCls} value={to ?? ''} onChange={(e) => onChange({ to: e.target.value })} /></Field>
    </div>
  );
}

function RuleEditor({ rule, vars, onChange, onRemove, canRemove }: { rule: ConditionRule; vars: FlowVar[]; onChange: (r: ConditionRule) => void; onRemove: () => void; canRemove: boolean }) {
  const tags = useTags();
  const kind = CONDITION_OPERANDS[rule.operand]?.kind ?? 'text';
  const set = (patch: Partial<ConditionRule>) => onChange({ ...rule, ...patch });
  // trocar de operando zera o que só fazia sentido no anterior
  const setOperand = (operand: ConditionOperand) => {
    const k = CONDITION_OPERANDS[operand].kind;
    onChange({ id: rule.id, operand, op: CONDITION_OPS[k][0].op, ...(k === 'text' ? { key: '', value: '' } : {}), ...(operand === 'now' ? { days: [1, 2, 3, 4, 5] } : {}) });
  };
  const listId = `vars-${rule.id}`;
  const textValue = kind === 'text' && rule.op !== 'empty' && rule.op !== 'not_empty';

  return (
    <div className="rounded-lg border border-line p-2 space-y-1.5 bg-panel">
      <div className="flex items-center gap-1.5">
        <select className={inputCls} value={rule.operand} onChange={(e) => setOperand(e.target.value as ConditionOperand)}>
          {(Object.keys(CONDITION_OPERANDS) as ConditionOperand[]).map((o) => <option key={o} value={o}>{CONDITION_OPERANDS[o].label}</option>)}
        </select>
        <button type="button" onClick={onRemove} disabled={!canRemove} className="text-faint hover:text-danger p-1 disabled:opacity-30" title="Remover regra"><X size={14} /></button>
      </div>

      {rule.operand === 'var' && (
        <>
          {/* texto livre + sugestões: a variável pode vir de um bloco que ainda não foi desenhado */}
          <input className={inputCls} list={listId} value={rule.key ?? ''} placeholder="nome_da_variavel" onChange={(e) => set({ key: e.target.value.replace(/[^\w]/g, '_').toLowerCase() })} />
          <datalist id={listId}>{vars.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}</datalist>
        </>
      )}
      {rule.operand === 'contact' && (
        <select className={inputCls} value={rule.key ?? ''} onChange={(e) => set({ key: e.target.value })}>
          <option value="">Campo…</option>
          {Object.entries(CONDITION_CONTACT_FIELD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )}
      {rule.operand === 'message' && <p className="text-[11px] text-muted">Última mensagem que o contato enviou nesta conversa.</p>}
      {rule.operand === 'tag' && (
        <select className={inputCls} value={rule.tagId ?? ''} onChange={(e) => set({ tagId: e.target.value })}>
          <option value="">Etiqueta…</option>
          {tags.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}

      <select className={inputCls} value={rule.op} onChange={(e) => set({ op: e.target.value as ConditionRule['op'] })}>
        {CONDITION_OPS[kind].map((o) => (
          <option key={o.op} value={o.op}>
            {rule.operand === 'tag' ? (o.op === 'is_true' ? 'conversa ou contato tem a etiqueta' : 'não tem a etiqueta')
              : rule.operand === 'business_hours' ? (o.op === 'is_true' ? 'dentro do expediente' : 'fora do expediente')
                : o.label}
          </option>
        ))}
      </select>

      {textValue && (
        <>
          <TextWithVars multiline={false} value={rule.value ?? ''} vars={vars} placeholder={NUMERIC.has(rule.op) ? 'número (ex.: 10,5)' : 'valor'} onChange={(v) => set({ value: v })} />
          {!NUMERIC.has(rule.op) && (
            <label className="flex items-center gap-2 text-[11.5px] text-muted">
              <input type="checkbox" checked={!!rule.caseSensitive} onChange={(e) => set({ caseSensitive: e.target.checked || undefined })} />
              Diferenciar maiúsculas/minúsculas e acentos
            </label>
          )}
        </>
      )}
      {rule.op === 'weekday_in' && <DaysPicker days={rule.days ?? []} onChange={(days) => set({ days })} />}
      {rule.op === 'time_between' && <TimeRange from={rule.from} to={rule.to} onChange={set} />}
      {rule.operand === 'now' && <p className="text-[11px] text-muted">No fuso do cliente (Configurações). Faixa que vira a meia-noite vale: 22:00 até 06:00.</p>}
      {rule.operand === 'business_hours' && (
        <>
          <label className="flex items-center gap-2 text-[11.5px] text-muted">
            <input type="checkbox" checked={!!rule.hours} onChange={(e) => set({ hours: e.target.checked ? { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] } : undefined })} />
            Usar horário próprio (em vez de Configurações → Horário)
          </label>
          {rule.hours && (
            <>
              <TimeRange from={rule.hours.start} to={rule.hours.end} onChange={(p) => set({ hours: { ...rule.hours!, ...(p.from !== undefined ? { start: p.from } : {}), ...(p.to !== undefined ? { end: p.to } : {}) } })} />
              <DaysPicker days={rule.hours.days} onChange={(days) => set({ hours: { ...rule.hours!, days } })} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Painel da Condição. Recebe os ramos já normalizados (formato antigo vira um ramo) e
 * devolve sempre no formato novo.
 */
export function ConditionPanel({ branches, vars, onChange }: { branches: ConditionBranch[]; vars: FlowVar[]; onChange: (b: ConditionBranch[]) => void }) {
  const update = (id: string, patch: Partial<ConditionBranch>) => onChange(branches.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...branches];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };

  return (
    <Field label="Ramos" hint="Avaliados de cima para baixo: o primeiro verdadeiro define a saída. Nenhum verdadeiro → Senão.">
      <div className="space-y-3">
        {branches.map((b, i) => (
          <div key={b.id} className="rounded-lg border border-line bg-field p-2 space-y-2">
            <div className="flex items-center gap-1">
              <input className={inputCls} value={b.label} placeholder="Nome do ramo" onChange={(e) => update(b.id, { label: e.target.value })} />
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-faint hover:text-ink p-1 disabled:opacity-30" title="Subir"><ChevronUp size={14} /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === branches.length - 1} className="text-faint hover:text-ink p-1 disabled:opacity-30" title="Descer"><ChevronDown size={14} /></button>
              <button type="button" onClick={() => onChange(branches.filter((x) => x.id !== b.id))} disabled={branches.length <= 1} className="text-faint hover:text-danger p-1 disabled:opacity-30" title="Remover ramo (a ligação dele some)"><X size={14} /></button>
            </div>
            {b.rules.length > 1 && (
              <select className={inputCls} value={b.match} onChange={(e) => update(b.id, { match: e.target.value as ConditionBranch['match'] })}>
                <option value="all">Todas as regras (E)</option>
                <option value="any">Qualquer regra (OU)</option>
              </select>
            )}
            {b.rules.map((r, ri) => (
              <div key={r.id}>
                {ri > 0 && <div className="text-center text-[10px] font-semibold text-muted py-0.5">{b.match === 'any' ? 'OU' : 'E'}</div>}
                <RuleEditor
                  rule={r}
                  vars={vars}
                  canRemove={b.rules.length > 1}
                  onChange={(nr) => update(b.id, { rules: b.rules.map((x) => (x.id === r.id ? nr : x)) })}
                  onRemove={() => update(b.id, { rules: b.rules.filter((x) => x.id !== r.id) })}
                />
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => update(b.id, { rules: [...b.rules, newRule()] })}>Regra</Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => onChange([...branches, newBranch(branches.length + 1)])}>Adicionar ramo</Button>
        <p className="text-[11px] text-muted rounded-lg bg-field px-3 py-2">A saída <b>Senão</b> sempre existe e é usada quando nenhum ramo é verdadeiro. Texto é comparado sem diferenciar maiúsculas e acentos, a menos que a regra peça.</p>
      </div>
    </Field>
  );
}
