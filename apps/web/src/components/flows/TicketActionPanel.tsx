'use client';
import Link from 'next/link';
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL, type FlowNode, type TicketPriority } from '@atendo/shared';
import { Field, inputCls } from '@/components/ui/Modal';
import { useAgents, useDepartments, useHasFeature, useTicketOptions } from '@/lib/hooks';
import { TextWithVars, type FlowVar } from './TextWithVars';

type Data = Extract<FlowNode, { type: 'action' }>['data'];

/**
 * Ação "Abrir ticket" (docs/tickets.md#pelo-fluxo): tipo, título e campos com as variáveis do fluxo.
 * O número volta em {{ticket}} para o fluxo responder o protocolo ao contato.
 */
export function TicketActionPanel({ d, set, vars }: { d: Data; set: (p: Record<string, unknown>) => void; vars: FlowVar[] }) {
  const feature = useHasFeature('tickets');
  const opts = useTicketOptions(feature.has);
  const agents = useAgents();
  const departments = useDepartments();
  if (!feature.loading && !feature.has) return <p className="text-[12px] rounded-lg bg-warn-soft text-warn-ink px-3 py-2">Tickets internos não estão no plano desta empresa: o bloco não abre nada e avisa a equipe na conversa.</p>;
  const tipos = (opts.data?.types ?? []).filter((t) => t.isActive || t.id === d.ticketTypeId);
  const tipo = tipos.find((t) => t.id === d.ticketTypeId);
  const campos = d.ticketFields ?? {};
  const varNome = d.ticketVar || 'ticket';

  return (
    <>
      <Field label="Tipo de ticket" hint={tipos.length ? 'Traz setor, prioridade, prazo e os campos do tipo.' : undefined}>
        <select className={`${inputCls} min-w-0 max-w-full`} value={d.ticketTypeId ?? ''} onChange={(e) => set({ ticketTypeId: e.target.value || undefined, ticketFields: {} })}>
          <option value="">Sem tipo (ticket livre)</option>
          {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isActive ? '' : ' (desativado)'}</option>)}
        </select>
      </Field>
      {!tipos.length && <p className="text-[11px] text-muted">Nenhum tipo cadastrado. Em <Link href="/tickets" className="underline">Tickets → Tipos</Link> dá para importar modelos (condomínio, farmácia, clínica…).</p>}
      <Field label="Título" hint={tipo ? `Vazio = "${tipo.name}".` : 'Ex.: Vazamento – {{contact.name}}'}>
        <TextWithVars multiline={false} value={d.ticketTitle ?? ''} onChange={(v) => set({ ticketTitle: v || undefined })} vars={vars} placeholder={tipo ? tipo.name : 'O que precisa'} />
      </Field>

      {tipo && tipo.fields.length > 0 && (
        <div className="rounded-lg border border-line p-2.5 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Campos de “{tipo.name}”</p>
          {tipo.fields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.type === 'select' ? `Opções: ${f.options?.join(', ')}` : undefined}>
              <TextWithVars multiline={false} value={campos[f.key] ?? ''} onChange={(v) => set({ ticketFields: { ...campos, [f.key]: v } })} vars={vars} placeholder={`{{${f.key}}}`} />
            </Field>
          ))}
          <p className="text-[11px] text-faint">Use as respostas das perguntas anteriores. Obrigatório vazio não impede: o ticket abre e a equipe recebe um aviso.</p>
        </div>
      )}

      <Field label="Detalhes (opcional)">
        <TextWithVars value={d.ticketDescription ?? ''} onChange={(v) => set({ ticketDescription: v || undefined })} vars={vars} placeholder="O que o contato contou: {{problema}}" />
      </Field>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2">
        <Field label="Setor">
          <select className={`${inputCls} min-w-0 max-w-full`} value={d.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value || undefined })}>
            <option value="">{tipo?.departmentId ? 'O do tipo' : 'Sem setor'}</option>
            {(departments.data ?? []).filter((x) => x.isActive || x.id === d.departmentId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Prioridade">
          <select className={`${inputCls} min-w-0 max-w-full`} value={d.ticketPriority ?? ''} onChange={(e) => set({ ticketPriority: (e.target.value || undefined) as TicketPriority | undefined })}>
            <option value="">{tipo ? `A do tipo (${TICKET_PRIORITY_LABEL[tipo.priority].toLowerCase()})` : 'Normal'}</option>
            {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p]}</option>)}
          </select>
        </Field>
        <Field label="Responsável">
          <select className={`${inputCls} min-w-0 max-w-full`} value={d.agentId ?? ''} onChange={(e) => set({ agentId: e.target.value || undefined })}>
            <option value="">Ninguém (o setor pega)</option>
            {agents.data?.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Prazo (dias)">
          <input type="number" min={1} max={365} className={`${inputCls} min-w-0 max-w-full`} value={d.ticketDueDays ?? ''} placeholder={tipo?.dueDays ? `${tipo.dueDays} (do tipo)` : 'sem prazo'}
            onChange={(e) => set({ ticketDueDays: e.target.value ? Math.max(1, Math.min(365, Math.round(Number(e.target.value)))) : undefined })} />
        </Field>
      </div>

      <Field label="Guardar o número em" hint={`Depois, responda ao contato: "Sua solicitação é o protocolo #{{${varNome}}}".`}>
        <input className={`${inputCls} min-w-0 max-w-full`} value={d.ticketVar ?? ''} placeholder="ticket" onChange={(e) => set({ ticketVar: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) || undefined })} />
      </Field>
      <p className="text-[11px] text-muted rounded-lg bg-field px-3 py-2">O ticket fica ligado a esta conversa (com as últimas mensagens), a conversa ganha o marco “🎫 Ticket #N aberto pelo fluxo” e quem é do setor recebe o aviso na hora. Se não abrir (fora do plano, erro), o fluxo segue e a equipe recebe uma nota.</p>
    </>
  );
}
