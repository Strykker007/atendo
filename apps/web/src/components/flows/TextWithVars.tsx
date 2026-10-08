'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Braces, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/ui/Modal';
import { CONTACT_FIXED_KEYS, SYSTEM_VARIABLES, VARIABLE_OP_LABEL, VARIABLE_SHORTCUTS, attributeVarKey } from '@atendo/shared';
import { useContactAttributeLabels } from '@/lib/hooks';
import { GlobalVarsMenuSection } from '@/components/variables/GlobalVariables';

export interface FlowVar { key: string; label: string; source: 'shortcut' | 'system' | 'attribute' | 'question' | 'menu' | 'action' }

/** Topo do menu: as mais usadas, com nome amigável (`VARIABLE_SHORTCUTS`). */
export const SHORTCUT_VARS: FlowVar[] = VARIABLE_SHORTCUTS.map((v) => ({ key: v.key, label: v.label, source: 'shortcut' }));
// já está nos atalhos (por chave ou apelido): não repete em "Do sistema"
const IN_SHORTCUTS = new Set(VARIABLE_SHORTCUTS.map((v) => v.key));
const MENU_SYSTEM_VARS = SYSTEM_VARIABLES
  .filter((v) => !IN_SHORTCUTS.has(v.key) && !v.aliases?.some((a) => IN_SHORTCUTS.has(a)))
  .map((v): FlowVar => ({ key: v.key, label: v.label, source: 'system' }));

/**
 * Variáveis sempre disponíveis (catálogo em `@atendo/shared`, docs/variaveis.md). Os apelidos
 * (`{{company.name}}`, `{{greeting}}`) valem igual no envio, mas o menu oferece só um nome.
 */
export const SYSTEM_VARS: FlowVar[] = SYSTEM_VARIABLES.map((v) => ({ key: v.key, label: v.label, source: 'system' }));

/**
 * Campos livres da ficha já usados em algum contato da empresa → `{{contact.<chave>}}`.
 * Contato que não tem o campo recebe vazio.
 */
export function useAttributeVars(): FlowVar[] {
  const labels = useContactAttributeLabels().data ?? [];
  const seen = new Set<string>(CONTACT_FIXED_KEYS);
  const out: FlowVar[] = [];
  for (const l of labels) {
    const k = attributeVarKey(l.label);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ key: `contact.${k}`, label: `${l.label} (campo da ficha)`, source: 'attribute' });
  }
  return out;
}

/** Marcadores de formatação do WhatsApp. */
const WA_MARKS: { mark: string; label: string; title: string; cls: string }[] = [
  { mark: '*', label: 'N', title: 'Negrito (*texto*)', cls: 'font-bold' },
  { mark: '_', label: 'I', title: 'Itálico (_texto_)', cls: 'italic' },
  { mark: '~', label: 'S', title: 'Tachado (~texto~)', cls: 'line-through' },
];

/**
 * Campo de texto com botão "Inserir variável": insere {{chave}} na posição do cursor.
 * Mostra as variáveis do sistema, as da empresa (com "Criar nova variável global" ali mesmo) e
 * as criadas pelo fluxo (Salvar / Menu / Manipulador).
 * `formatting`: botões de negrito/itálico/tachado do WhatsApp (envolvem a seleção).
 */
export function TextWithVars({ value, onChange, vars, multiline = true, placeholder, className, formatting, flowVarsGroup = true, required, maxLength }: { value: string; onChange: (v: string) => void; vars: FlowVar[]; multiline?: boolean; placeholder?: string; className?: string; formatting?: boolean; /** fora do editor de fluxos (respostas rápidas) não existe "criadas neste fluxo" */ flowVarsGroup?: boolean; required?: boolean; maxLength?: number }) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  function insert(key: string) {
    const el = ref.current;
    const token = `{{${key}}}`;
    if (!el) return onChange(value + token);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  }

  function wrapSelection(mark: string) {
    const el = ref.current;
    if (!el) return onChange(`${value}${mark}${mark}`);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    onChange(value.slice(0, start) + mark + value.slice(start, end) + mark + value.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + 1, end + 1); });
  }

  const attributeVars = useAttributeVars();
  const groups: [string, FlowVar[]][] = [
    ['Mais usadas', SHORTCUT_VARS],
    ['Do sistema', [...MENU_SYSTEM_VARS, ...vars.filter((v) => v.source === 'system')]],
    ...(attributeVars.length ? [['Campos da ficha', attributeVars] as [string, FlowVar[]]] : []),
    ...(flowVarsGroup ? [['Criadas neste fluxo', vars.filter((v) => v.source !== 'system' && v.source !== 'attribute')] as [string, FlowVar[]]] : []),
  ];

  return (
    <div ref={wrap} className="relative">
      {multiline ? (
        <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} className={cn(inputCls, 'min-h-24 pr-2', className)} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required} maxLength={maxLength} />
      ) : (
        <input ref={ref as React.RefObject<HTMLInputElement>} className={cn(inputCls, className)} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required} maxLength={maxLength} />
      )}
      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent-ink hover:underline whitespace-nowrap">
            <Braces size={12} /> Inserir variável <ChevronDown size={11} />
          </button>
          {formatting && WA_MARKS.map((f) => (
            <button key={f.mark} type="button" title={f.title} onClick={() => wrapSelection(f.mark)} className={cn('w-5 h-5 rounded text-[11px] text-muted hover:bg-field hover:text-ink', f.cls)}>{f.label}</button>
          ))}
        </div>
        <span className="text-[10.5px] text-faint truncate ml-2" title="O texto entre {{ }} é trocado pelo valor na hora do envio">{'{{ }}'} vira o valor no envio</span>
        {/* só nos fluxos: o robô sorteia as variações; resposta rápida sai como está (docs/envio.md#variações-de-texto) */}
        {flowVarsGroup && <span className="text-[10.5px] text-faint truncate ml-2" title="Ex.: {Oi|Olá|Bom dia}, tudo bem? — cada contato recebe uma das opções. Texto idêntico para muita gente é padrão de spam na Conexão Web (QR Code).">{'{Oi|Olá}'} sorteia uma</span>}
      </div>
      {open && (
        <div data-overlay className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-line bg-panel shadow-lg py-1 max-h-64 overflow-y-auto text-sm">
          {groups.map(([title, list]) => (
            <Fragment key={title}>
            <div>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</div>
              {list.length === 0 && title === 'Criadas neste fluxo' && <div className="px-3 pb-2 text-xs text-faint">Nenhuma ainda — adicione um bloco <b>Salvar</b> ou <b>Manipulador</b> para criar.</div>}
              {list.map((v) => (
                <button type="button" key={v.key} onClick={() => insert(v.key)} className="w-full text-left px-3 py-1.5 hover:bg-field">
                  <div className="font-mono text-[12px] text-ink">{`{{${v.key}}}`}</div>
                  <div className="text-[11px] text-muted">{v.label}</div>
                </button>
              ))}
            </div>
            {/* logo depois das mais usadas: é o que a empresa cadastrou para usar sempre */}
            {title === 'Mais usadas' && <GlobalVarsMenuSection keyFirst onPick={insert} />}
            </Fragment>
          ))}
          <VarSyntaxHint />
        </div>
      )}
    </div>
  );
}

/** Rodapé do menu: os filtros e o valor padrão (docs/variaveis.md). */
export function VarSyntaxHint() {
  return (
    <div className="mt-1 border-t border-line px-3 pt-2 pb-1.5 text-[11px] text-muted leading-relaxed">
      Filtros: <code className="font-mono text-ink">{'{{contact.name | upper}}'}</code> · <code className="font-mono">first</code> <code className="font-mono">last</code> <code className="font-mono">title</code> <code className="font-mono">upper</code> <code className="font-mono">lower</code> <code className="font-mono">formatted</code>
      <br />
      Se vazio: <code className="font-mono text-ink">{"{{contact.first_name || 'Cliente'}}"}</code>
    </div>
  );
}

/** Variáveis criadas pelos blocos do fluxo (Salvar → varName; Menu → escolha; Manipulador; webhook). */
export function collectFlowVars(nodes: { id: string; type: string; data: Record<string, unknown> }[]): FlowVar[] {
  const out: FlowVar[] = [];
  for (const n of nodes) {
    if (n.type === 'question' && typeof n.data.varName === 'string' && n.data.varName) {
      out.push({ key: n.data.varName, label: `Resposta de "${String(n.data.text ?? '').slice(0, 40) || 'Salvar'}"`, source: 'question' });
    }
    if (n.type === 'variable' && Array.isArray(n.data.assignments)) {
      for (const a of n.data.assignments as { varName?: string; value?: string; op?: string }[]) {
        const how = !a.op || a.op === 'set' ? `valor: "${String(a.value ?? '').slice(0, 30)}"` : (VARIABLE_OP_LABEL as Record<string, string>)[a.op]?.toLowerCase();
        if (a.varName) out.push({ key: a.varName, label: `Manipulador (${how})`, source: 'action' });
      }
    }
    if (n.type === 'action' && n.data.kind === 'webhook' && typeof n.data.responseVar === 'string' && n.data.responseVar) {
      out.push({ key: n.data.responseVar, label: 'Resposta do webhook', source: 'action' });
    }
    if (n.type === 'menu') out.push({ key: `menu_${n.id}`, label: `Opção escolhida em "${String(n.data.text ?? '').slice(0, 40) || 'Menu'}"`, source: 'menu' });
    if (n.type === 'schedule') out.push({ key: 'agendamento', label: 'Horário agendado (bloco Agendar)', source: 'action' }, { key: 'servico', label: 'Serviço agendado', source: 'action' }, { key: 'profissional', label: 'Profissional agendado', source: 'action' });
    if (n.type === 'action' && n.data.kind === 'set_var' && typeof n.data.varName === 'string' && n.data.varName) {
      out.push({ key: n.data.varName, label: `Definida pela ação (valor: "${String(n.data.value ?? '').slice(0, 30)}")`, source: 'action' });
    }
  }
  // a mesma variável definida em dois blocos aparece uma vez só
  return out.filter((v, i) => out.findIndex((x) => x.key === v.key) === i);
}

/**
 * Prévia da formatação do WhatsApp: *negrito*, _itálico_, ~tachado~. O marcador só vale
 * colado ao texto (`* x*` não formata), como no app.
 */
export function WaText({ text }: { text: string }) {
  // {{variável}} entra antes na alternância: o "_" do nome não pode virar itálico
  const parts = text.split(/(\{\{[^}]*\}\}|\*[^*\s][^*]*?\*|_[^_\s][^_]*?_|~[^~\s][^~]*?~)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('{{')) return <span key={i} className="font-mono text-accent-ink">{p}</span>;
        const inner = p.slice(1, -1);
        if (p.length > 2 && !/\s$/.test(inner)) {
          if (p.startsWith('*') && p.endsWith('*')) return <b key={i}>{inner}</b>;
          if (p.startsWith('_') && p.endsWith('_')) return <i key={i}>{inner}</i>;
          if (p.startsWith('~') && p.endsWith('~')) return <s key={i}>{inner}</s>;
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}
