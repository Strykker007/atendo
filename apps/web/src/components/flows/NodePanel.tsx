'use client';
import { Trash2, Plus, X } from 'lucide-react';
import { Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { NODE_META } from './nodes';
import { useTags, useAgents } from '@/lib/hooks';
import type { FlowNode } from '@atendo/shared';

/** Painel lateral: edita os dados do bloco selecionado. Cada tipo tem seus campos. */
export function NodePanel({ node, onChange, onDelete }: { node: FlowNode; onChange: (data: FlowNode['data']) => void; onDelete: () => void }) {
  const tags = useTags();
  const agents = useAgents();
  const m = NODE_META[node.type];
  const set = (patch: Record<string, unknown>) => onChange({ ...(node.data as object), ...patch } as FlowNode['data']);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
        <span className={`w-6 h-6 rounded-md grid place-items-center ${m.color}`}>{m.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink">{m.label}</div>
          <div className="text-[11px] text-muted truncate">{m.hint}</div>
        </div>
        {node.type !== 'start' && <button onClick={onDelete} className="text-faint hover:text-danger p-1" title="Remover bloco"><Trash2 size={15} /></button>}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        {node.type === 'start' && <p className="text-muted">O gatilho (manual, nova conversa ou palavra-chave) é definido nas configurações do fluxo, no topo da tela.</p>}

        {node.type === 'message' && (
          <>
            <Field label="Texto" hint="Variáveis: {{contact.name}}, {{contact.phone}} e as das perguntas, ex.: {{email}}">
              <textarea className={`${inputCls} min-h-28`} value={node.data.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
            </Field>
            <p className="text-[11px] text-faint">Anexar imagem/arquivo ao bloco: em breve (use uma resposta rápida por enquanto).</p>
          </>
        )}

        {node.type === 'question' && (
          <>
            <Field label="Pergunta"><textarea className={`${inputCls} min-h-20`} value={node.data.text} onChange={(e) => set({ text: e.target.value })} /></Field>
            <Field label="Guardar resposta em" hint="Nome da variável, sem espaços. Use depois como {{nome}}">
              <input className={inputCls} value={node.data.varName} onChange={(e) => set({ varName: e.target.value.replace(/[^\w]/g, '_').toLowerCase() })} />
            </Field>
            <Field label="Validação">
              <select className={inputCls} value={node.data.validation} onChange={(e) => set({ validation: e.target.value })}>
                <option value="none">Qualquer texto</option><option value="email">E-mail</option><option value="phone">Telefone</option><option value="number">Número</option>
              </select>
            </Field>
            <Field label="Mensagem se inválido"><input className={inputCls} value={node.data.invalidText ?? ''} onChange={(e) => set({ invalidText: e.target.value })} placeholder="Não entendi. Pode repetir?" /></Field>
            <Field label="Tentativas antes de desistir" hint="Depois disso, entrega para humano"><input type="number" min={0} max={5} className={inputCls} value={node.data.maxRetries} onChange={(e) => set({ maxRetries: Number(e.target.value) })} /></Field>
          </>
        )}

        {node.type === 'menu' && (
          <>
            <Field label="Texto do menu" hint="As opções são numeradas automaticamente"><textarea className={`${inputCls} min-h-20`} value={node.data.text} onChange={(e) => set({ text: e.target.value })} /></Field>
            <Field label="Opções">
              <div className="space-y-1.5">
                {node.data.options.map((o, i) => (
                  <div key={o.id} className="flex items-center gap-1.5">
                    <span className="tnum font-mono text-xs text-faint w-4">{i + 1}</span>
                    <input className={inputCls} value={o.label} onChange={(e) => set({ options: node.data.options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })} />
                    <button onClick={() => set({ options: node.data.options.filter((x) => x.id !== o.id) })} className="text-faint hover:text-danger p-1" disabled={node.data.options.length <= 1}><X size={14} /></button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => set({ options: [...node.data.options, { id: crypto.randomUUID().slice(0, 8), label: `Opção ${node.data.options.length + 1}` }] })}>Adicionar opção</Button>
              </div>
            </Field>
            <Field label="Mensagem se inválido"><input className={inputCls} value={node.data.invalidText ?? ''} onChange={(e) => set({ invalidText: e.target.value })} placeholder="Opção inválida. Responda com o número." /></Field>
            <Field label="Tentativas" hint="Depois disso segue pela saída 'resposta inválida' ou entrega para humano"><input type="number" min={0} max={5} className={inputCls} value={node.data.maxRetries} onChange={(e) => set({ maxRetries: Number(e.target.value) })} /></Field>
          </>
        )}

        {node.type === 'condition' && (
          <>
            <Field label="Tipo">
              <select className={inputCls} value={node.data.kind} onChange={(e) => set({ kind: e.target.value })}>
                <option value="var_equals">Variável é igual a</option><option value="var_contains">Variável contém</option><option value="has_tag">Conversa tem a tag</option><option value="business_hours">Está no horário comercial</option>
              </select>
            </Field>
            {(node.data.kind === 'var_equals' || node.data.kind === 'var_contains') && (
              <>
                <Field label="Variável"><input className={inputCls} value={node.data.varName ?? ''} onChange={(e) => set({ varName: e.target.value })} placeholder="email" /></Field>
                <Field label="Valor"><input className={inputCls} value={node.data.value ?? ''} onChange={(e) => set({ value: e.target.value })} /></Field>
              </>
            )}
            {node.data.kind === 'has_tag' && (
              <Field label="Tag"><select className={inputCls} value={node.data.tagId ?? ''} onChange={(e) => set({ tagId: e.target.value })}><option value="">Escolha…</option>{tags.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
            )}
            {node.data.kind === 'business_hours' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Das"><input type="time" className={inputCls} value={node.data.hours?.start ?? '08:00'} onChange={(e) => set({ hours: { ...(node.data.hours ?? { days: [1, 2, 3, 4, 5], end: '18:00' }), start: e.target.value } })} /></Field>
                <Field label="Até"><input type="time" className={inputCls} value={node.data.hours?.end ?? '18:00'} onChange={(e) => set({ hours: { ...(node.data.hours ?? { days: [1, 2, 3, 4, 5], start: '08:00' }), end: e.target.value } })} /></Field>
                <div className="col-span-2 flex flex-wrap gap-1">
                  {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((l, i) => {
                    const days = node.data.hours?.days ?? [1, 2, 3, 4, 5];
                    const on = days.includes(i);
                    return <button key={i} type="button" onClick={() => set({ hours: { start: '08:00', end: '18:00', ...(node.data.hours ?? {}), days: on ? days.filter((d) => d !== i) : [...days, i] } })} className={`w-7 h-7 rounded-md text-xs font-semibold ${on ? 'bg-accent text-white' : 'bg-field text-muted'}`}>{l}</button>;
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {node.type === 'action' && (
          <>
            <Field label="Ação">
              <select className={inputCls} value={node.data.kind} onChange={(e) => set({ kind: e.target.value })}>
                <option value="add_tag">Aplicar tag</option><option value="remove_tag">Remover tag</option><option value="assign">Atribuir a atendente</option><option value="set_status">Mudar status</option><option value="handoff">Entregar para humano (fim do fluxo)</option>
              </select>
            </Field>
            {(node.data.kind === 'add_tag' || node.data.kind === 'remove_tag') && (
              <>
                <Field label="Tag"><select className={inputCls} value={node.data.tagId ?? ''} onChange={(e) => set({ tagId: e.target.value })}><option value="">Escolha…</option>{tags.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
                <Field label="Aplicar em" hint="Contato = vale para sempre, em todas as conversas dessa pessoa (ex.: comprador recorrente)">
                  <div className="grid grid-cols-2 gap-2">
                    {([['conversation', 'Esta conversa'], ['contact', '📌 Contato']] as const).map(([v, l]) => (
                      <button type="button" key={v} onClick={() => set({ scope: v })} className={`rounded-lg border px-3 py-1.5 text-sm ${(node.data.scope ?? 'conversation') === v ? 'border-accent bg-accent-soft text-ink' : 'border-line text-muted hover:bg-field'}`}>{l}</button>
                    ))}
                  </div>
                </Field>
              </>
            )}
            {(node.data.kind === 'assign' || node.data.kind === 'handoff') && (
              <Field label={node.data.kind === 'handoff' ? 'Atribuir a (opcional)' : 'Atendente'} hint={node.data.kind === 'handoff' ? 'Vazio = volta para a fila "Aguardando"' : undefined}>
                <select className={inputCls} value={node.data.agentId ?? ''} onChange={(e) => set({ agentId: e.target.value || undefined })}><option value="">{node.data.kind === 'handoff' ? 'Fila (qualquer atendente)' : 'Escolha…'}</option>{agents.data?.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </Field>
            )}
            {node.data.kind === 'set_status' && (
              <Field label="Status"><select className={inputCls} value={node.data.status ?? 'waiting'} onChange={(e) => set({ status: e.target.value })}><option value="waiting">Aguardando</option><option value="in_progress">Em atendimento</option><option value="closed">Encerrado</option></select></Field>
            )}
          </>
        )}

        {node.type === 'wait' && <Field label="Minutos"><input type="number" min={1} className={inputCls} value={node.data.minutes} onChange={(e) => set({ minutes: Number(e.target.value) })} /></Field>}

        {node.type === 'end' && (
          <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={node.data.closeConversation} onChange={(e) => set({ closeConversation: e.target.checked })} /> Encerrar a conversa ao terminar</label>
        )}
      </div>
    </div>
  );
}
