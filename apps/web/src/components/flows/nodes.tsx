'use client';
import { createContext, useContext } from 'react';
import { Handle, Position, useNodeId, type NodeProps } from '@xyflow/react';
import { Play, MessageSquare, Save, ListOrdered, GitBranch, Zap, Clock, Flag, CalendarClock, Sparkles, Variable, Shuffle, Users, AlertTriangle, Copy, Workflow, ExternalLink, Image as ImageIcon, Film, FileText, Mic, Timer, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CLOSED_BAND_ID, DEPARTMENT_NONE, CONDITION_CONTACT_FIELD_LABEL, CONDITION_ELSE, CONDITION_OPERANDS, CONDITION_OPS, RETRIES_EXHAUSTED_HANDLE, bandKey, REPLY_TIMEOUT_HANDLE, WEBHOOK_ERROR_HANDLE, normalizeCondition, normalizeContent,
  type ConditionBranch, type ConditionContactField, type ConditionNode, type ConditionRule, type ContentItem, type DelayUnit, type FlowNode, type FlowNodeType, type MessageNode, type VariableAssignment,
} from '@atendo/shared';
import { WaText } from './TextWithVars';
import { useDepartments, useSchedules } from '@/lib/hooks';

/**
 * Categorias da paleta. A cor é da categoria (roxo = estrutura, amarelo/laranja = lógica,
 * azul = distribuição), para o desenho se ler de longe: dá para ver onde o fluxo decide e
 * onde ele entrega sem abrir nenhum card.
 */
export const PALETTE_GROUPS: { label: string; types: FlowNodeType[] }[] = [
  { label: 'Estrutura e Conteúdo', types: ['message', 'menu', 'variable', 'connect_flow', 'end'] },
  { label: 'Lógica e Decisão', types: ['action', 'randomizer', 'condition', 'wait', 'ai'] },
  { label: 'Distribuição e Envio', types: ['question', 'distributor', 'schedule'] },
];

const PURPLE = 'bg-c4 text-white';
const YELLOW = 'bg-c5 text-white';
const ORANGE = 'bg-c2 text-white';
const BLUE = 'bg-c1 text-white';

/** Aparência de cada tipo de bloco: ícone e cor (tokens do tema). */
export const NODE_META: Record<FlowNodeType, { icon: React.ReactNode; color: string; label: string; hint: string }> = {
  start: { icon: <Play size={13} />, color: 'bg-ok text-white', label: 'Início', hint: 'Onde o fluxo começa' },
  message: { icon: <MessageSquare size={13} />, color: PURPLE, label: 'Conteúdo', hint: 'Texto, imagem, vídeo, documento ou áudio — várias mensagens em sequência' },
  connect_flow: { icon: <Workflow size={13} />, color: PURPLE, label: 'Conectar com outro fluxo', hint: 'Termina este fluxo e começa outro do início, levando as variáveis' },
  menu: { icon: <ListOrdered size={13} />, color: PURPLE, label: 'Menu', hint: 'Opções numeradas, cada uma com uma saída; tentativas e tempo limite' },
  variable: { icon: <Variable size={13} />, color: PURPLE, label: 'Manipulador', hint: 'Define, soma, concatena, limpa ou copia variáveis do fluxo' },
  end: { icon: <Flag size={13} />, color: PURPLE, label: 'Fim', hint: 'Encerra o fluxo' },
  action: { icon: <Zap size={13} />, color: ORANGE, label: 'Ação', hint: 'Etiqueta, atribuir, status, encerrar, webhook ou humano' },
  randomizer: { icon: <Shuffle size={13} />, color: YELLOW, label: 'Randomizador', hint: 'Divide o tráfego por percentual (teste A/B)' },
  condition: { icon: <GitBranch size={13} />, color: YELLOW, label: 'Condição', hint: 'Vários caminhos por regras (E/OU) com variável, contato, mensagem ou horário' },
  wait: { icon: <Clock size={13} />, color: ORANGE, label: 'Atraso inteligente', hint: 'Espera um tempo ou até o próximo horário de atendimento' },
  ai: { icon: <Sparkles size={13} />, color: YELLOW, label: 'IA', hint: 'Responde com suas instruções ou classifica a mensagem' },
  question: { icon: <Save size={13} />, color: BLUE, label: 'Salvar', hint: 'Espera a resposta e guarda numa variável ou no contato' },
  distributor: { icon: <Users size={13} />, color: BLUE, label: 'Distribuidor', hint: 'Entrega a conversa: rodízio, menos ocupado ou fila' },
  schedule: { icon: <CalendarClock size={13} />, color: BLUE, label: 'Agendar horário', hint: 'Serviço → profissional → horário → confirma' },
};

/** Ações do editor que o próprio card dispara (ele só conhece o id dele). */
export const FlowNodeActions = createContext<{ duplicate: (id: string) => void } | null>(null);

export type ProviderKind = 'meta' | 'evolution';
/**
 * Dados do editor que os cards e o painel leem: fluxos do cliente (destino do Conectar), links
 * assinados dos anexos (prévia) e os provedores dos números do cliente (avisos de formato).
 */
export interface FlowRefs {
  flowId?: string;
  flows?: { id: string; name: string; isActive: boolean }[];
  mediaUrl: (key?: string) => string | undefined;
  rememberMedia: (key: string, url: string) => void;
  providers: ProviderKind[];
}
export const FlowEditorRefs = createContext<FlowRefs>({ mediaUrl: () => undefined, rememberMedia: () => undefined, providers: ['meta', 'evolution'] });

/**
 * O que um provedor não entrega como desenhado. Os dois usam o mesmo WhatsApp do contato,
 * mas a API oficial (Meta) é mais restrita que a Evolution — avisar no editor em vez de
 * descobrir pela mensagem que falhou.
 */
export function contentWarnings(it: ContentItem, providers: ProviderKind[]): string[] {
  const out: string[] = [];
  const meta = providers.includes('meta');
  const mime = it.mimeType ?? '';
  if (meta && it.kind === 'image' && mime === 'image/webp') out.push('Meta (API oficial): WebP não é aceito como imagem — use JPG ou PNG.');
  if (meta && it.kind === 'audio' && it.voice !== false && mime && mime !== 'audio/ogg') out.push('Meta (API oficial): só OGG (Opus) chega como áudio gravado; este formato chega como arquivo de áudio.');
  if (meta && it.kind === 'audio' && it.voice === false) out.push('Meta (API oficial): não há "áudio como arquivo" — o contato recebe o áudio para tocar.');
  return out;
}

const MEDIA_ICON = { image: ImageIcon, video: Film, document: FileText, audio: Mic } as const;

/** Prévia de uma mensagem do Conteúdo, como o contato vai ver. `compact` = card do canvas. */
export function ContentPreview({ item, compact }: { item: ContentItem; compact?: boolean }) {
  const { mediaUrl } = useContext(FlowEditorRefs);
  const bubble = 'rounded-lg bg-field px-2 py-1.5 text-[11.5px] text-ink leading-snug break-words';
  const caption = item.text ? <div className={cn('whitespace-pre-wrap', compact && 'line-clamp-3')}><WaText text={item.text} /></div> : null;
  if (item.kind === 'text') {
    return <div className={cn(bubble, 'whitespace-pre-wrap', compact && 'line-clamp-4')}>{item.text ? <WaText text={item.text} /> : <span className="italic text-faint">texto vazio</span>}</div>;
  }
  const Icon = MEDIA_ICON[item.kind];
  const url = mediaUrl(item.mediaKey);
  const fileRow = (
    <div className="flex items-center gap-1.5 min-w-0">
      <Icon size={13} className="shrink-0 text-muted" />
      <span className="truncate">{item.mediaKey ? (item.mediaName ?? 'arquivo') : <span className="italic text-faint">arquivo não enviado</span>}</span>
      {item.kind === 'audio' && <span className="shrink-0 text-[10px] text-faint">{item.voice === false ? 'arquivo' : 'gravado'}</span>}
    </div>
  );
  return (
    <div className={cn(bubble, 'space-y-1')}>
      {item.kind === 'image' && url ? <img src={url} alt={item.mediaName ?? ''} className={cn('w-full rounded object-cover', compact ? 'max-h-20' : 'max-h-56')} />
        : item.kind === 'video' && url && !compact ? <video src={url} controls className="w-full rounded max-h-56" />
          : item.kind === 'audio' && url && !compact ? <><audio src={url} controls className="w-full h-8" />{fileRow}</>
            : fileRow}
      {caption}
    </div>
  );
}

const handleCls = '!w-2.5 !h-2.5 !bg-panel !border-2 !border-line-strong hover:!border-accent';

/** Entrada sempre à esquerda: o fluxo corre da esquerda para a direita. */
const In = () => <Handle type="target" position={Position.Left} className={handleCls} />;
/** Saída única, no meio da lateral direita. */
const Out = () => <Handle type="source" position={Position.Right} className={handleCls} />;

/** Uma linha por saída, com a bolinha à direita alinhada à própria linha. Sem `id` = saída padrão (a mesma do `<Out/>`). */
function OutRow({ id, children, tone = 'default' }: { id?: string; children: React.ReactNode; tone?: 'default' | 'ok' | 'danger' | 'dashed' }) {
  return (
    <div className={cn(
      'relative flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]',
      tone === 'dashed' ? 'border border-dashed border-line text-faint text-[10.5px]' : 'bg-field text-ink',
      tone === 'ok' && 'text-ok font-semibold',
      tone === 'danger' && 'text-danger font-semibold',
    )}>
      {children}
      <Handle type="source" position={Position.Right} id={id} className={cn(handleCls, '!-right-3')} />
    </div>
  );
}
const Rows = ({ children }: { children: React.ReactNode }) => <div className="px-2 pb-2 space-y-1">{children}</div>;

function Shell({ type, selected, children, summary, data }: { type: FlowNodeType; selected?: boolean; children?: React.ReactNode; summary?: string; data?: Record<string, unknown> }) {
  const m = NODE_META[type];
  const id = useNodeId();
  const actions = useContext(FlowNodeActions);
  const reconfig = Array.isArray(data?._reconfig) ? (data._reconfig as string[]) : [];
  return (
    <div className={cn('group rounded-xl border bg-panel shadow-sm min-w-[200px] max-w-[240px] text-left transition-shadow', selected ? 'border-accent ring-2 ring-accent/30' : reconfig.length ? 'border-warn' : 'border-line')}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line">
        <span className={cn('w-5 h-5 rounded-md grid place-items-center', m.color)}>{m.icon}</span>
        <span className="text-[12px] font-semibold text-ink">{m.label}</span>
        {type !== 'start' && id && actions && (
          <button
            type="button"
            title="Duplicar bloco (Ctrl+D)"
            onClick={(e) => { e.stopPropagation(); actions.duplicate(id); }}
            className={cn('nodrag ml-auto p-0.5 rounded text-faint hover:text-ink hover:bg-field', selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
          >
            <Copy size={12} />
          </button>
        )}
      </div>
      {reconfig.length > 0 && (
        <div className="flex items-start gap-1 px-3 py-1 text-[10.5px] bg-warn-soft text-warn-ink" title="Veio de outro cliente: revise e salve o bloco">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" /> Reconfigurar: {reconfig.join(', ')}
        </div>
      )}
      {summary !== undefined && <div className="px-3 py-2 text-[11.5px] text-muted leading-snug line-clamp-3 whitespace-pre-wrap">{summary || <span className="italic text-faint">clique para configurar</span>}</div>}
      {children}
    </div>
  );
}

type P = NodeProps & { data: FlowNode['data'] & Record<string, unknown> };

export function StartNodeView({ selected }: P) {
  return (
    <Shell type="start" selected={selected} summary="Começa aqui">
      <Out />
    </Shell>
  );
}
export function MessageNodeView({ data, selected }: P) {
  const items = normalizeContent(data as MessageNode['data']);
  const { providers } = useContext(FlowEditorRefs);
  const warn = items.some((it) => contentWarnings(it, providers).length > 0);
  return (
    <Shell type="message" data={data} selected={selected}>
      <In />
      <div className="px-2 py-2 space-y-1">
        {items.length === 0 && <div className="px-1 text-[11.5px] italic text-faint">clique para configurar</div>}
        {items.slice(0, 4).map((it, i) => (
          <div key={it.id} className="space-y-1">
            {i > 0 && Number(it.delay) > 0 && <div className="flex items-center gap-1 px-1 text-[10px] text-faint"><Timer size={10} /> espera {it.delay}s</div>}
            <ContentPreview item={it} compact />
          </div>
        ))}
        {items.length > 4 && <div className="px-1 text-[10.5px] text-faint"><Paperclip size={10} className="inline" /> +{items.length - 4} mensagem(ns)</div>}
        {warn && <div className="flex items-start gap-1 rounded px-1.5 py-1 text-[10.5px] bg-warn-soft text-warn-ink"><AlertTriangle size={11} className="mt-0.5 shrink-0" /> Formato com limitação na API oficial (Meta)</div>}
      </div>
      <Out />
    </Shell>
  );
}

export function ConnectFlowNodeView({ data, selected }: P) {
  const d = data as { flowId?: string; flowName?: string };
  const { flows, flowId } = useContext(FlowEditorRefs);
  const target = flows?.find((f) => f.id === d.flowId);
  // lista ainda carregando: não acusa "excluído" antes da hora
  const problem = !d.flowId || !flows ? null : !target ? 'O fluxo de destino foi excluído' : !target.isActive ? 'O fluxo de destino está desativado' : null;
  return (
    <Shell type="connect_flow" data={data} selected={selected}>
      <In />
      <div className="px-3 py-2 text-[11.5px] space-y-1">
        {d.flowId ? (
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-ink">→ {target?.name ?? d.flowName ?? 'fluxo excluído'}</span>
            {target && (
              <a href={`/fluxos/${target.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="nodrag shrink-0 p-0.5 rounded text-faint hover:text-ink hover:bg-field" title="Abrir o fluxo de destino (nova aba)">
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        ) : <span className="italic text-faint">{d.flowName ? `Era: ${d.flowName} — escolha o destino` : 'clique para escolher o fluxo'}</span>}
        {target && target.id === flowId && <div className="text-[10.5px] text-muted">Recomeça este mesmo fluxo</div>}
        {problem && <div className="flex items-start gap-1 rounded px-1.5 py-1 text-[10.5px] bg-danger-soft text-danger-ink"><AlertTriangle size={11} className="mt-0.5 shrink-0" /> {problem} — a automação para aqui e a conversa fica com o atendente</div>}
        <div className="text-[10.5px] text-faint">Este fluxo termina aqui; o destino começa do início, com as variáveis.</div>
      </div>
    </Shell>
  );
}
/** Saída "Não respondeu" do Salvar/Menu — só aparece com tempo limite. */
const TimeoutRow = ({ minutes, unit, businessHours }: { minutes?: number; unit?: DelayUnit; businessHours?: boolean }) =>
  minutes ? <OutRow id={REPLY_TIMEOUT_HANDLE} tone="dashed"><Timer size={11} className="shrink-0" /> Não respondeu em {formatDelay(minutes, unit)}{businessHours ? ' (no horário)' : ''}</OutRow> : null;

export function QuestionNodeView({ data, selected }: P) {
  const d = data as { text?: string; varName?: string; contactField?: string; timeoutMinutes?: number; timeoutUnit?: DelayUnit; timeoutBusinessHours?: boolean };
  const dest = `→ {{${d.varName || '?'}}}${d.contactField ? ' + ficha do contato' : ''}`;
  return (
    <Shell type="question" data={data} selected={selected} summary={d.text ? `${d.text}\n${dest}` : `Espera a resposta\n${dest}`}>
      <In />
      <Rows>
        <OutRow tone="ok">Respondeu</OutRow>
        <OutRow id={RETRIES_EXHAUSTED_HANDLE} tone="dashed">Tentativas esgotadas</OutRow>
        <TimeoutRow minutes={d.timeoutMinutes} unit={d.timeoutUnit} businessHours={d.timeoutBusinessHours} />
      </Rows>
    </Shell>
  );
}
export function MenuNodeView({ data, selected }: P) {
  const d = data as { text?: string; options?: { id: string; label: string }[]; timeoutMinutes?: number; timeoutUnit?: DelayUnit; timeoutBusinessHours?: boolean };
  return (
    <Shell type="menu" data={data} selected={selected} summary={d.text}>
      <In />
      <Rows>
        {(d.options ?? []).map((o, i) => (
          <OutRow key={o.id} id={o.id}><span className="tnum font-mono text-faint">{i + 1}</span> <span className="truncate">{o.label || '(opção)'}</span></OutRow>
        ))}
        <OutRow id={RETRIES_EXHAUSTED_HANDLE} tone="dashed">Tentativas esgotadas</OutRow>
        <TimeoutRow minutes={d.timeoutMinutes} unit={d.timeoutUnit} businessHours={d.timeoutBusinessHours} />
      </Rows>
    </Shell>
  );
}
const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Uma regra em texto curto, para o card e para o cabeçalho da regra no painel. */
export function ruleSummary(r: ConditionRule): string {
  const meta = CONDITION_OPERANDS[r.operand];
  const opLabel = meta ? CONDITION_OPS[meta.kind].find((o) => o.op === r.op)?.label ?? r.op : r.op;
  const subject = r.operand === 'var' ? `{{${r.key || '?'}}}`
    : r.operand === 'contact' ? `contato.${CONDITION_CONTACT_FIELD_LABEL[r.key as ConditionContactField]?.toLowerCase() ?? '?'}`
      : r.operand === 'message' ? 'mensagem'
        : r.operand === 'now' ? 'agora'
          : meta?.label ?? r.operand;
  if (r.op === 'empty' || r.op === 'not_empty') return `${subject} ${opLabel}`;
  if (r.op === 'weekday_in') return `${subject}: ${(r.days ?? []).slice().sort().map((d) => WEEKDAY_SHORT[d]).join(', ') || '?'}`;
  if (r.op === 'time_between') return `${subject} entre ${r.from || '?'} e ${r.to || '?'}`;
  if (r.operand === 'tag') return r.op === 'is_true' ? 'tem a etiqueta' : 'não tem a etiqueta';
  if (r.operand === 'business_hours') return r.op === 'is_true' ? 'dentro do horário de atendimento' : 'fora do horário de atendimento';
  if (r.operand === 'schedule_band') return `faixa ${r.op === 'is_true' ? 'é' : 'não é'} "${r.band === 'closed' ? 'Fechado' : r.band || '?'}"`;
  return `${subject} ${opLabel} "${r.value ?? ''}"`;
}

/**
 * Faixas citadas em "Faixa de horário atual" que não existem em nenhum quadro do cliente
 * (comparadas pelo nome, como no motor). Enquanto os quadros carregam, não acusa nada.
 */
function useMissingBands(branches: ConditionBranch[]): string[] {
  const schedules = useSchedules();
  if (!schedules.data) return [];
  const known = new Set(schedules.data.flatMap((q) => q.config.bands.map((b) => bandKey(b.name))));
  const wanted = branches.flatMap((b) => b.rules).filter((r) => r.operand === 'schedule_band' && r.band && r.band !== CLOSED_BAND_ID).map((r) => r.band!.trim());
  return [...new Set(wanted.filter((n) => !known.has(bandKey(n))))];
}

export function ConditionNodeView({ data, selected }: P) {
  const branches = normalizeCondition(data as ConditionNode['data']);
  const missing = useMissingBands(branches);
  return (
    <Shell type="condition" data={data} selected={selected}>
      <In />
      {missing.length > 0 && (
        <p className="mt-2 flex items-start gap-1 rounded-md bg-danger/10 px-2 py-1 text-[10.5px] text-danger">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
          <span>Faixa {missing.map((m) => `"${m}"`).join(', ')} não existe em nenhum quadro de horários: a regra nunca casa.</span>
        </p>
      )}
      <div className="pt-2"><Rows>
        {branches.map((b) => (
          <OutRow key={b.id} id={b.id}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{b.label || '(ramo)'}</span>
              <span className="block truncate text-[10px] text-muted">
                {b.rules.length ? b.rules.map(ruleSummary).join(b.match === 'any' ? ' OU ' : ' E ') : 'sem regras'}
              </span>
            </span>
          </OutRow>
        ))}
        <OutRow id={CONDITION_ELSE} tone="dashed">Senão</OutRow>
      </Rows></div>
    </Shell>
  );
}
const STATUS_LABEL: Record<string, string> = { waiting: 'Aguardando', in_progress: 'Em atendimento', closed: 'Encerrado' };
export function ActionNodeView({ data, selected }: P) {
  const d = data as { kind?: string; scope?: string; varName?: string; value?: string; url?: string; method?: string; status?: string; departmentId?: string };
  const departments = useDepartments();
  const dept = d.departmentId === DEPARTMENT_NONE ? 'Sem departamento' : departments.data?.find((x) => x.id === d.departmentId)?.name ?? (d.departmentId && departments.data ? 'departamento excluído' : '?');
  const label = d.kind === 'set_status' && d.status === 'closed' ? 'Encerrar conversa'
    : ({ add_tag: 'Aplicar etiqueta', remove_tag: 'Remover etiqueta', assign: 'Atribuir a atendente', set_status: `Mudar status${d.status ? ` → ${STATUS_LABEL[d.status] ?? d.status}` : ''}`, handoff: 'Entregar para humano', webhook: 'Chamar webhook', set_department: `Departamento → ${dept}` } as Record<string, string>)[d.kind ?? ''] ?? '';
  const txt = d.kind === 'set_var' ? `{{${d.varName || '?'}}} = ${d.value ?? ''}` : d.kind === 'webhook' ? `${label}${d.url ? `\n${d.method ?? 'POST'} ${d.url}` : ''}` : label + (d.scope === 'contact' && (d.kind === 'add_tag' || d.kind === 'remove_tag') ? ' 📌 no contato' : '');
  return (
    <Shell type="action" data={data} selected={selected} summary={txt}>
      <In />
      {d.kind === 'webhook'
        ? <Rows><OutRow tone="ok">Sucesso</OutRow><OutRow id={WEBHOOK_ERROR_HANDLE} tone="danger">Erro</OutRow></Rows>
        : d.kind !== 'handoff' && <Out />}
    </Shell>
  );
}
export function WaitNodeView({ data, selected }: P) {
  const d = data as { mode?: 'duration' | 'next_open'; minutes?: number; unit?: DelayUnit; businessHours?: boolean };
  const summary = d.mode === 'next_open' ? 'Até o próximo horário de atendimento' : d.minutes ? `${formatDelay(d.minutes, d.unit)}${d.businessHours ? '\nsó no horário de atendimento' : ''}` : '';
  return (
    <Shell type="wait" data={data} selected={selected} summary={summary}>
      <In /><Out />
    </Shell>
  );
}
export function EndNodeView({ data, selected }: P) {
  const d = data as { closeConversation?: boolean };
  return (
    <Shell type="end" data={data} selected={selected} summary={d.closeConversation ? 'Encerra a conversa' : 'Mantém a conversa aberta'}>
      <In />
    </Shell>
  );
}

export function ScheduleNodeView({ data, selected }: P) {
  const d = data as { serviceId?: string; professionalId?: string; maxSlots?: number };
  return (
    <Shell type="schedule" data={data} selected={selected} summary={`${d.serviceId ? 'Serviço fixo' : 'Pergunta o serviço'} · ${d.professionalId ? 'profissional fixo' : 'pergunta o profissional'} · ${d.maxSlots ?? 6} horários por vez`}>
      <In />
      <Rows>
        <OutRow id="done" tone="ok">Agendou</OutRow>
        <OutRow id="fallback" tone="danger">Não conseguiu</OutRow>
      </Rows>
    </Shell>
  );
}

export function AiNodeView({ data, selected }: P) {
  const d = data as { mode?: 'answer' | 'classify'; instructions?: string; labels?: { id: string; label: string }[]; keepTalking?: boolean; maxTurns?: number };
  return (
    <Shell type="ai" data={data} selected={selected} summary={d.instructions || ''}>
      <In />
      <Rows>
        {d.mode === 'classify'
          ? (d.labels ?? []).map((l) => <OutRow key={l.id} id={l.id}><span className="truncate">{l.label || '(rótulo)'}</span></OutRow>)
          : <OutRow id="done" tone="ok">{d.keepTalking ? `Após ${d.maxTurns ?? 10} respostas` : 'Respondeu'}</OutRow>}
        <OutRow id="fallback" tone={d.mode === 'classify' ? 'dashed' : 'danger'}>Não conseguiu</OutRow>
      </Rows>
    </Shell>
  );
}

/** Uma operação do Manipulador em texto curto. */
function assignmentSummary(a: VariableAssignment) {
  const v = `{{${a.varName}}}`;
  switch (a.op ?? 'set') {
    case 'add': return `${v} + ${a.value}`;
    case 'subtract': return `${v} − ${a.value}`;
    case 'append': return `${v} += "${a.value}"`;
    case 'clear': return `${v} = (vazio)`;
    case 'copy': return `${v} = {{${a.from || '?'}}}`;
    case 'now': return `${v} = agora`;
    default: return `${v} = ${a.value}`;
  }
}

export function VariableNodeView({ data, selected }: P) {
  const d = data as { assignments?: VariableAssignment[] };
  return (
    <Shell type="variable" data={data} selected={selected} summary={(d.assignments ?? []).filter((a) => a.varName).map(assignmentSummary).join('\n')}>
      <In /><Out />
    </Shell>
  );
}

export function RandomizerNodeView({ data, selected }: P) {
  const d = data as { branches?: { id: string; label: string; weight: number }[] };
  const branches = d.branches ?? [];
  const total = branches.reduce((s, b) => s + Math.max(0, Number(b.weight) || 0), 0);
  return (
    <Shell type="randomizer" data={data} selected={selected}>
      <In />
      <div className="pt-2"><Rows>
        {branches.map((b) => (
          <OutRow key={b.id} id={b.id}>
            <span className="truncate flex-1">{b.label || '(ramo)'}</span>
            <span className="tnum text-faint">{total ? Math.round((Math.max(0, Number(b.weight) || 0) / total) * 100) : 0}%</span>
          </OutRow>
        ))}
      </Rows></div>
    </Shell>
  );
}

export function DistributorNodeView({ data, selected }: P) {
  const d = data as { mode?: string; agentIds?: string[]; departmentId?: string };
  const departments = useDepartments();
  const mode = ({ round_robin: 'Rodízio', least_busy: 'Menos ocupado', queue: 'Fila (qualquer atendente)' } as Record<string, string>)[d.mode ?? ''] ?? '';
  const dept = d.departmentId ? departments.data?.find((x) => x.id === d.departmentId) : undefined;
  const deptLine = d.departmentId ? `\nDepartamento: ${dept ? `${dept.name}${dept.isActive ? '' : ' (desativado)'}` : departments.data ? 'excluído' : '…'}` : '';
  const who = d.agentIds?.length ? `${d.agentIds.length} atendente(s)` : d.departmentId ? 'todos do departamento' : 'todos os atendentes';
  return (
    <Shell type="distributor" data={data} selected={selected} summary={(d.mode === 'queue' ? mode : `${mode} · ${who}`) + deptLine}>
      <In />
      <Rows>
        <OutRow id="done" tone="ok">Distribuído</OutRow>
        {d.mode !== 'queue' && <OutRow id="fallback" tone="danger">Ninguém disponível</OutRow>}
      </Rows>
    </Shell>
  );
}

export const nodeTypes = {
  ai: AiNodeView, schedule: ScheduleNodeView, start: StartNodeView, message: MessageNodeView, question: QuestionNodeView, menu: MenuNodeView,
  condition: ConditionNodeView, action: ActionNodeView, wait: WaitNodeView, end: EndNodeView, variable: VariableNodeView, randomizer: RandomizerNodeView, distributor: DistributorNodeView,
  connect_flow: ConnectFlowNodeView,
};

export const DELAY_UNIT: Record<DelayUnit, { label: string; factor: number }> = {
  minutes: { label: 'minutos', factor: 1 },
  hours: { label: 'horas', factor: 60 },
  days: { label: 'dias', factor: 1440 },
};
/** `minutes` é sempre o total; a unidade só muda como aparece. */
export function formatDelay(minutes: number, unit: DelayUnit = 'minutes') {
  const u = DELAY_UNIT[unit] ?? DELAY_UNIT.minutes;
  return `${+(minutes / u.factor).toFixed(2)} ${u.label}`;
}

const shortId = () => crypto.randomUUID().slice(0, 8);

export const newRule = (): ConditionRule => ({ id: shortId(), operand: 'var', key: '', op: 'eq', value: '' });
export const newBranch = (n: number): ConditionBranch => ({ id: shortId(), label: `Ramo ${n}`, match: 'all', rules: [newRule()] });

/** Dados iniciais de um bloco novo. */
export function defaultData(type: FlowNodeType): FlowNode['data'] {
  switch (type) {
    case 'start': return {} as never;
    case 'message': return { items: [{ id: shortId(), kind: 'text', text: '' }] };
    case 'question': return { text: '', varName: 'resposta', validation: 'none', maxRetries: 2 };
    case 'menu': return { text: '', options: [{ id: shortId(), label: 'Opção 1' }, { id: shortId(), label: 'Opção 2' }], maxRetries: 1 };
    case 'condition': return { branches: [newBranch(1)] };
    case 'action': return { kind: 'add_tag' };
    case 'wait': return { minutes: 5, unit: 'minutes', businessHours: false };
    case 'end': return { closeConversation: false };
    case 'schedule': return { maxSlots: 6 };
    case 'ai': return { mode: 'answer', instructions: '', knowledge: '', fallbackText: 'Vou verificar isso com um atendente, um momento.', keepTalking: true, maxTurns: 10 };
    case 'variable': return { assignments: [{ id: shortId(), varName: '', op: 'set', value: '' }] };
    case 'randomizer': return { branches: [{ id: shortId(), label: 'A', weight: 50 }, { id: shortId(), label: 'B', weight: 50 }] };
    case 'distributor': return { mode: 'round_robin', agentIds: [] };
    case 'connect_flow': return {};
  }
}
