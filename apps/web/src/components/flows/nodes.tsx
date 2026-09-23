'use client';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Play, MessageSquare, HelpCircle, ListOrdered, GitBranch, Zap, Clock, Flag, CalendarClock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FlowNode, FlowNodeType } from '@atendo/shared';

/** Aparência de cada tipo de bloco: ícone e cor (tokens do tema). */
export const NODE_META: Record<FlowNodeType, { icon: React.ReactNode; color: string; label: string; hint: string }> = {
  start: { icon: <Play size={13} />, color: 'bg-ok text-white', label: 'Início', hint: 'Onde o fluxo começa' },
  message: { icon: <MessageSquare size={13} />, color: 'bg-accent text-white', label: 'Enviar mensagem', hint: 'Texto ou arquivo para o contato' },
  question: { icon: <HelpCircle size={13} />, color: 'bg-c4 text-white', label: 'Perguntar', hint: 'Espera a resposta e guarda numa variável' },
  menu: { icon: <ListOrdered size={13} />, color: 'bg-c4 text-white', label: 'Menu de opções', hint: 'Opções numeradas, cada uma com uma saída' },
  condition: { icon: <GitBranch size={13} />, color: 'bg-c5 text-white', label: 'Condição', hint: 'Sim / Não conforme variável, tag ou horário' },
  action: { icon: <Zap size={13} />, color: 'bg-c2 text-white', label: 'Ação', hint: 'Tag, atribuir, status ou entregar para humano' },
  wait: { icon: <Clock size={13} />, color: 'bg-done text-white', label: 'Aguardar', hint: 'Pausa de X minutos' },
  end: { icon: <Flag size={13} />, color: 'bg-danger text-white', label: 'Fim', hint: 'Encerra o fluxo' },
  schedule: { icon: <CalendarClock size={13} />, color: 'bg-c3 text-white', label: 'Agendar horário', hint: 'Serviço → profissional → horário → confirma' },
  ai: { icon: <Sparkles size={13} />, color: 'bg-c1 text-white', label: 'IA', hint: 'Responde com suas instruções ou classifica a mensagem' },
};

const handleCls = '!w-2.5 !h-2.5 !bg-panel !border-2 !border-line-strong hover:!border-accent';

function Shell({ type, selected, children, summary }: { type: FlowNodeType; selected?: boolean; children?: React.ReactNode; summary?: string }) {
  const m = NODE_META[type];
  return (
    <div className={cn('rounded-xl border bg-panel shadow-sm min-w-[200px] max-w-[240px] text-left transition-shadow', selected ? 'border-accent ring-2 ring-accent/30' : 'border-line')}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line">
        <span className={cn('w-5 h-5 rounded-md grid place-items-center', m.color)}>{m.icon}</span>
        <span className="text-[12px] font-semibold text-ink">{m.label}</span>
      </div>
      {summary !== undefined && <div className="px-3 py-2 text-[11.5px] text-muted leading-snug line-clamp-3 whitespace-pre-wrap">{summary || <span className="italic text-faint">clique para configurar</span>}</div>}
      {children}
    </div>
  );
}

type P = NodeProps & { data: FlowNode['data'] & Record<string, unknown> };

export function StartNodeView({ selected }: P) {
  return (
    <Shell type="start" selected={selected} summary="Começa aqui">
      <Handle type="source" position={Position.Bottom} className={handleCls} />
    </Shell>
  );
}
export function MessageNodeView({ data, selected }: P) {
  const d = data as { text?: string; mediaName?: string };
  return (
    <Shell type="message" selected={selected} summary={[d.text, d.mediaName && `📎 ${d.mediaName}`].filter(Boolean).join('\n')}>
      <Handle type="target" position={Position.Top} className={handleCls} />
      <Handle type="source" position={Position.Bottom} className={handleCls} />
    </Shell>
  );
}
export function QuestionNodeView({ data, selected }: P) {
  const d = data as { text?: string; varName?: string };
  return (
    <Shell type="question" selected={selected} summary={d.text ? `${d.text}\n→ {{${d.varName || '?'}}}` : ''}>
      <Handle type="target" position={Position.Top} className={handleCls} />
      <Handle type="source" position={Position.Bottom} className={handleCls} />
    </Shell>
  );
}
export function MenuNodeView({ data, selected }: P) {
  const d = data as { text?: string; options?: { id: string; label: string }[] };
  const opts = d.options ?? [];
  return (
    <Shell type="menu" selected={selected} summary={d.text}>
      <Handle type="target" position={Position.Top} className={handleCls} />
      <div className="px-2 pb-2 space-y-1">
        {opts.map((o, i) => (
          <div key={o.id} className="relative flex items-center gap-1.5 rounded-md bg-field px-2 py-1 text-[11px] text-ink">
            <span className="tnum font-mono text-faint">{i + 1}</span> <span className="truncate">{o.label || '(opção)'}</span>
            <Handle type="source" position={Position.Right} id={o.id} className={cn(handleCls, '!-right-3')} />
          </div>
        ))}
        <div className="relative flex items-center rounded-md border border-dashed border-line px-2 py-1 text-[10.5px] text-faint">
          resposta inválida (após tentativas)
          <Handle type="source" position={Position.Right} id="fallback" className={cn(handleCls, '!-right-3')} />
        </div>
      </div>
    </Shell>
  );
}
export function ConditionNodeView({ data, selected }: P) {
  const d = data as { kind?: string; varName?: string; value?: string };
  const txt = d.kind === 'business_hours' ? 'Dentro do horário comercial?' : d.kind === 'has_tag' ? 'Conversa tem a tag?' : d.kind ? `{{${d.varName || '?'}}} ${d.kind === 'var_equals' ? '=' : 'contém'} "${d.value ?? ''}"` : '';
  return (
    <Shell type="condition" selected={selected} summary={txt}>
      <Handle type="target" position={Position.Top} className={handleCls} />
      <div className="flex justify-between px-3 pb-2 text-[10.5px] font-semibold">
        <span className="relative text-ok pr-2">Sim<Handle type="source" position={Position.Bottom} id="yes" className={cn(handleCls, '!left-4')} /></span>
        <span className="relative text-danger pl-2">Não<Handle type="source" position={Position.Bottom} id="no" className={cn(handleCls, '!left-auto !right-4')} /></span>
      </div>
    </Shell>
  );
}
export function ActionNodeView({ data, selected }: P) {
  const d = data as { kind?: string; scope?: string; varName?: string; value?: string };
  const txt = d.kind === 'set_var' ? `{{${d.varName || '?'}}} = ${d.value ?? ''}` : (({ add_tag: 'Aplicar tag', remove_tag: 'Remover tag', assign: 'Atribuir a atendente', set_status: 'Mudar status', handoff: 'Entregar para humano' } as Record<string, string>)[d.kind ?? ''] ?? '') + (d.scope === 'contact' && (d.kind === 'add_tag' || d.kind === 'remove_tag') ? ' 📌 no contato' : '');
  return (
    <Shell type="action" selected={selected} summary={txt}>
      <Handle type="target" position={Position.Top} className={handleCls} />
      {d.kind !== 'handoff' && <Handle type="source" position={Position.Bottom} className={handleCls} />}
    </Shell>
  );
}
export function WaitNodeView({ data, selected }: P) {
  const d = data as { minutes?: number };
  return (
    <Shell type="wait" selected={selected} summary={d.minutes ? `${d.minutes} min` : ''}>
      <Handle type="target" position={Position.Top} className={handleCls} />
      <Handle type="source" position={Position.Bottom} className={handleCls} />
    </Shell>
  );
}
export function EndNodeView({ data, selected }: P) {
  const d = data as { closeConversation?: boolean };
  return (
    <Shell type="end" selected={selected} summary={d.closeConversation ? 'Encerra a conversa' : 'Mantém a conversa aberta'}>
      <Handle type="target" position={Position.Top} className={handleCls} />
    </Shell>
  );
}

export function ScheduleNodeView({ data, selected }: P) {
  const d = data as { serviceId?: string; professionalId?: string; maxSlots?: number };
  return (
    <Shell type="schedule" selected={selected} summary={`${d.serviceId ? 'Serviço fixo' : 'Pergunta o serviço'} · ${d.professionalId ? 'profissional fixo' : 'pergunta o profissional'} · ${d.maxSlots ?? 6} horários por vez`}>
      <Handle type="target" position={Position.Top} className={handleCls} />
      <div className="flex justify-between px-3 pb-2 text-[10.5px] font-semibold">
        <span className="relative text-ok pr-2">Agendou<Handle type="source" position={Position.Bottom} id="done" className={cn(handleCls, '!left-4')} /></span>
        <span className="relative text-danger pl-2">Não conseguiu<Handle type="source" position={Position.Bottom} id="fallback" className={cn(handleCls, '!left-auto !right-4')} /></span>
      </div>
    </Shell>
  );
}

export function AiNodeView({ data, selected }: P) {
  const d = data as { mode?: 'answer' | 'classify'; instructions?: string; knowledge?: string; labels?: { id: string; label: string }[] };
  const classify = d.mode === 'classify';
  return (
    <Shell type="ai" selected={selected} summary={d.instructions || ''}>
      <Handle type="target" position={Position.Top} className={handleCls} />
      {classify ? (
        <div className="px-2 pb-2 space-y-1">
          {(d.labels ?? []).map((l) => (
            <div key={l.id} className="relative flex items-center gap-1.5 rounded-md bg-field px-2 py-1 text-[11px] text-ink">
              <span className="truncate">{l.label || '(rótulo)'}</span>
              <Handle type="source" position={Position.Right} id={l.id} className={cn(handleCls, '!-right-3')} />
            </div>
          ))}
          <div className="relative flex items-center rounded-md border border-dashed border-line px-2 py-1 text-[10.5px] text-faint">
            Não conseguiu
            <Handle type="source" position={Position.Right} id="fallback" className={cn(handleCls, '!-right-3')} />
          </div>
        </div>
      ) : (
        <div className="flex justify-between px-3 pb-2 text-[10.5px] font-semibold">
          <span className="relative text-ok pr-2">Respondeu<Handle type="source" position={Position.Bottom} id="done" className={cn(handleCls, '!left-4')} /></span>
          <span className="relative text-danger pl-2">Não conseguiu<Handle type="source" position={Position.Bottom} id="fallback" className={cn(handleCls, '!left-auto !right-4')} /></span>
        </div>
      )}
    </Shell>
  );
}

export const nodeTypes = { ai: AiNodeView, schedule: ScheduleNodeView, start: StartNodeView, message: MessageNodeView, question: QuestionNodeView, menu: MenuNodeView, condition: ConditionNodeView, action: ActionNodeView, wait: WaitNodeView, end: EndNodeView };

/** Dados iniciais de um bloco novo. */
export function defaultData(type: FlowNodeType): FlowNode['data'] {
  switch (type) {
    case 'start': return {} as never;
    case 'message': return { text: '' };
    case 'question': return { text: '', varName: 'resposta', validation: 'none', maxRetries: 2 };
    case 'menu': return { text: '', options: [{ id: crypto.randomUUID().slice(0, 8), label: 'Opção 1' }, { id: crypto.randomUUID().slice(0, 8), label: 'Opção 2' }], maxRetries: 1 };
    case 'condition': return { kind: 'var_equals', varName: '', value: '' };
    case 'action': return { kind: 'add_tag' };
    case 'wait': return { minutes: 5 };
    case 'end': return { closeConversation: false };
    case 'schedule': return { maxSlots: 6 };
    case 'ai': return { mode: 'answer', instructions: '', knowledge: '', fallbackText: 'Vou verificar isso com um atendente, um momento.' };
  }
}
