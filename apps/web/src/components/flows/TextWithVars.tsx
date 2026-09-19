'use client';
import { useEffect, useRef, useState } from 'react';
import { Braces, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/ui/Modal';

export interface FlowVar { key: string; label: string; source: 'system' | 'question' | 'menu' | 'action' }

/** Variáveis sempre disponíveis. */
export const SYSTEM_VARS: FlowVar[] = [
  { key: 'contact.name', label: 'Nome do contato (como está no WhatsApp)', source: 'system' },
  { key: 'contact.phone', label: 'Telefone do contato', source: 'system' },
];

/**
 * Campo de texto com botão "Inserir variável": insere {{chave}} na posição do cursor.
 * Mostra as variáveis do sistema e as criadas pelo fluxo (Perguntar / Menu).
 */
export function TextWithVars({ value, onChange, vars, multiline = true, placeholder, className }: { value: string; onChange: (v: string) => void; vars: FlowVar[]; multiline?: boolean; placeholder?: string; className?: string }) {
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

  const all = [...SYSTEM_VARS, ...vars];
  const groups: [string, FlowVar[]][] = [['Do sistema', all.filter((v) => v.source === 'system')], ['Criadas neste fluxo', all.filter((v) => v.source !== 'system')]];

  return (
    <div ref={wrap} className="relative">
      {multiline ? (
        <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} className={cn(inputCls, 'min-h-24 pr-2', className)} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input ref={ref as React.RefObject<HTMLInputElement>} className={cn(inputCls, className)} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
      <div className="mt-1 flex items-center justify-between">
        <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent-ink hover:underline whitespace-nowrap">
          <Braces size={12} /> Inserir variável <ChevronDown size={11} />
        </button>
        <span className="text-[10.5px] text-faint truncate ml-2" title="O texto entre {{ }} é trocado pelo valor na hora do envio">{'{{ }}'} vira o valor no envio</span>
      </div>
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-line bg-panel shadow-lg py-1 max-h-64 overflow-y-auto text-sm">
          {groups.map(([title, list]) => (
            <div key={title}>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</div>
              {list.length === 0 && <div className="px-3 pb-2 text-xs text-faint">Nenhuma ainda — adicione um bloco <b>Perguntar</b> para criar.</div>}
              {list.map((v) => (
                <button type="button" key={v.key} onClick={() => insert(v.key)} className="w-full text-left px-3 py-1.5 hover:bg-field">
                  <div className="font-mono text-[12px] text-ink">{`{{${v.key}}}`}</div>
                  <div className="text-[11px] text-muted">{v.label}</div>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Variáveis criadas pelos blocos do fluxo (Perguntar → varName; Menu → escolha). */
export function collectFlowVars(nodes: { id: string; type: string; data: Record<string, unknown> }[]): FlowVar[] {
  const out: FlowVar[] = [];
  for (const n of nodes) {
    if (n.type === 'question' && typeof n.data.varName === 'string' && n.data.varName) {
      out.push({ key: n.data.varName, label: `Resposta de "${String(n.data.text ?? '').slice(0, 40) || 'Perguntar'}"`, source: 'question' });
    }
    if (n.type === 'menu') out.push({ key: `menu_${n.id}`, label: `Opção escolhida em "${String(n.data.text ?? '').slice(0, 40) || 'Menu'}"`, source: 'menu' });
    if (n.type === 'schedule') out.push({ key: 'agendamento', label: 'Horário agendado (bloco Agendar)', source: 'action' }, { key: 'servico', label: 'Serviço agendado', source: 'action' }, { key: 'profissional', label: 'Profissional agendado', source: 'action' });
    if (n.type === 'action' && n.data.kind === 'set_var' && typeof n.data.varName === 'string' && n.data.varName) {
      out.push({ key: n.data.varName, label: `Definida pela ação (valor: "${String(n.data.value ?? '').slice(0, 30)}")`, source: 'action' });
    }
  }
  return out;
}
