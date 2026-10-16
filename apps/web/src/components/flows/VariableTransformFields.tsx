'use client';
import type { VariableAssignment } from '@atendo/shared';
import { Field } from '@/components/ui/Modal';
import { TextWithVars, type FlowVar } from './TextWithVars';

/** Parâmetros declarativos; nenhum campo aceita código executável. */
export function VariableTransformFields({ assignment: a, vars, onChange }: { assignment: VariableAssignment; vars: FlowVar[]; onChange: (patch: Partial<VariableAssignment>) => void }) {
  if (!a.op || ['set', 'add', 'subtract', 'append', 'clear', 'copy', 'now'].includes(a.op)) return null;
  const field = (key: 'pattern' | 'replacement' | 'start' | 'length' | 'decimals' | 'path' | 'days' | 'otherDate', label: string, placeholder: string) => <Field key={key} label={label}><TextWithVars multiline={false} value={a[key] ?? ''} vars={vars} placeholder={placeholder} onChange={(value) => onChange({ [key]: value })} /></Field>;
  return <div className="min-w-0 space-y-2">
    <Field label={a.op === 'expression' ? 'Expressão' : 'Valor de origem'}>
      <TextWithVars value={a.value} vars={vars} placeholder={a.op === 'expression' ? '({{total}} - {{desconto}}) / 2' : '{{resposta}}'} onChange={(value) => onChange({ value })} maxLength={a.op === 'expression' ? 1000 : undefined} />
    </Field>
    {(a.op === 'replace' || a.op === 'extract') && field('pattern', a.op === 'extract' ? 'Regex (primeiro grupo)' : 'Texto ou regex a localizar', '(\\d+)')}
    {a.op === 'replace' && <>
      {field('replacement', 'Substituir por', 'novo texto')}
      <label className="flex gap-2"><input type="checkbox" checked={!!a.regex} onChange={(e) => onChange({ regex: e.target.checked })} />Usar regex simples</label>
    </>}
    {(a.op === 'extract' || (a.op === 'replace' && a.regex)) && <p className="text-xs text-muted">Máximo de 200 caracteres no padrão e 2.000 no texto. Sem alternativas, lookaround, referências ou repetição de grupos; no máximo uma repetição.</p>}
    {a.op === 'slice' && <>{field('start', 'Início (a partir de zero)', '0')}{field('length', 'Tamanho', '1000')}</>}
    {a.op === 'round' && field('decimals', 'Casas decimais (0 a 10)', '2')}
    {a.op === 'json_path' && field('path', 'Caminho no JSON', 'a.b[0].c')}
    {a.op === 'date_add' && field('days', 'Dias (negativo subtrai)', '-1')}
    {a.op === 'date_diff' && field('otherDate', 'Subtrair esta data', '{{data_inicial}}')}
    {a.op.startsWith('date_') && <p className="text-xs text-muted">Datas DD/MM/AAAA, AAAA-MM-DD ou ISO com fuso. Timestamps usam o dia no fuso do cliente. Formatar retorna DD/MM/AAAA; somar dias retorna AAAA-MM-DD.</p>}
    {a.op === 'expression' && <p className="text-xs text-muted">Números com ponto decimal, variáveis, + − * / e parênteses. Erro deixa a variável vazia e registra aviso.</p>}
  </div>;
}
