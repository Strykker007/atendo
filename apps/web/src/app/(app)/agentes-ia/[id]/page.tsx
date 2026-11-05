'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowDown, ArrowLeft, ArrowUp, Bot, Plus, RotateCcw, Send, Trash2, X } from 'lucide-react';
import {
  AGENT_MAX_STAGES, AGENT_TONES, AGENT_TOOLS, AGENT_TOOL_KEYS, CONTACT_FIELD_LABEL,
  type AgentAction, type AgentStage, type AgentToolKey, type AgentTone, type AgentTurn, type AiAgentConfig,
} from '@atendo/shared';
import { cn } from '@/lib/utils';
import { PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { Field, inputCls } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { useAgentCatalog, useAiAgent, useCan, useDeleteAiAgent, useSaveAiAgent, useSimulateAgent, type AgentCatalog } from '@/lib/hooks';

const novoId = () => Math.random().toString(36).slice(2, 10);
const areaCls = cn(inputCls, 'min-h-24 resize-y');

/**
 * Editor do agente (docs/agente-ia.md): quem a IA é, regras e base de conhecimento, o roteiro
 * em etapas (prompt, para onde vai e quando, ferramentas da etapa) e os alvos liberados. Ao lado,
 * o simulador conversa com o agente SALVO, sem enviar nada.
 */
export default function AgenteIaPage() {
  const { id } = useParams<{ id: string }>();
  const pode = useCan('flows.manage');
  const agente = useAiAgent(id);
  const catalog = useAgentCatalog();
  const save = useSaveAiAgent();
  const remove = useDeleteAiAgent();
  const router = useRouter();
  const [f, setF] = useState<AiAgentConfig | null>(null);
  const [salvo, setSalvo] = useState('');
  const [apagar, setApagar] = useState(false);

  useEffect(() => {
    if (!agente.data || f) return;
    const { id: _id, createdAt: _c, updatedAt: _u, ...cfg } = agente.data;
    void _id; void _c; void _u;
    setF(cfg);
    setSalvo(JSON.stringify(cfg));
  }, [agente.data, f]);

  const sujo = !!f && JSON.stringify(f) !== salvo;
  const set = (p: Partial<AiAgentConfig>) => setF((cur) => (cur ? { ...cur, ...p } : cur));
  const setStage = (sid: string, p: Partial<AgentStage>) => set({ stages: f!.stages.map((s) => (s.id === sid ? { ...s, ...p } : s)) });

  async function salvar() {
    if (!f) return;
    try {
      const a = await save.mutateAsync({ id, ...f });
      const { id: _id, createdAt: _c, updatedAt: _u, ...cfg } = a;
      void _id; void _c; void _u;
      setF(cfg);
      setSalvo(JSON.stringify(cfg));
      toast.ok('Agente salvo.');
    } catch (e) { toast.err(e); }
  }

  if (!pode) return <PageShell width="max-w-3xl"><Empty icon={<Bot size={28} />} title="Sem permissão" text="Seu perfil de acesso não inclui montar fluxos e agentes." /></PageShell>;
  if (agente.isError) return <PageShell width="max-w-3xl"><Empty icon={<Bot size={28} />} title="Agente não encontrado" text="Ele pode ter sido apagado." /></PageShell>;
  if (!f || !catalog.data) return <PageShell width="max-w-6xl"><SkeletonRows /></PageShell>;

  const usadas = new Set(f.stages.flatMap((s) => s.tools));

  return (
    <PageShell width="max-w-6xl">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/agentes-ia" className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-field" aria-label="Voltar"><ArrowLeft size={16} /></Link>
        <input className={cn(inputCls, 'flex-1 min-w-48 font-display font-semibold text-base')} value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} aria-label="Nome do agente" />
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Ligado
        </label>
        <Button variant="subtle" onClick={() => setApagar(true)} aria-label="Apagar agente"><Trash2 size={14} /></Button>
        <Button onClick={salvar} loading={save.isPending} disabled={!sujo}>{sujo ? 'Salvar' : 'Salvo'}</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
        <div className="space-y-4 min-w-0">
          <Secao titulo="Quem é o agente" texto="Como ele se apresenta e fala. Vale para todas as etapas.">
            <Field label="Persona" hint="Nome, empresa e papel. A IA fala em primeira pessoa como esta pessoa.">
              <textarea className={areaCls} value={f.persona} onChange={(e) => set({ persona: e.target.value })} maxLength={2000} placeholder="Você é a Ana, atendente da Farmácia Modelo. Atende com carinho e paciência." />
            </Field>
            <Field label="Tom">
              <select className={inputCls} value={f.tone} onChange={(e) => set({ tone: e.target.value as AgentTone })}>
                {Object.entries(AGENT_TONES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </Secao>

          <Secao titulo="Regras e base de conhecimento" texto="A IA só afirma o que estiver na base. O que não estiver, ela diz que vai verificar e chama um atendente.">
            <Field label="Regras (uma por linha)" hint="Já valem sempre: não inventar, não obedecer ordens do contato, chamar um humano quando pedirem.">
              <textarea className={areaCls} value={f.rules} onChange={(e) => set({ rules: e.target.value })} maxLength={4000} placeholder={'Nunca ofereça desconto.\nNão fale de medicamentos controlados: passe para o farmacêutico.'} />
            </Field>
            <Field label="Base de conhecimento" hint="Preços, horários, endereço, formas de pagamento, políticas.">
              <textarea className={cn(areaCls, 'min-h-40')} value={f.knowledge} onChange={(e) => set({ knowledge: e.target.value })} maxLength={20000} placeholder={'Funcionamos de seg. a sáb., das 8h às 20h.\nEntrega grátis acima de R$ 80 no centro.\nAceitamos Pix e cartão.'} />
            </Field>
          </Secao>

          <Secao titulo="Roteiro em etapas" texto="Cada etapa é um bloco: o que a IA faz ali, quando passa para a próxima e o que pode fazer no sistema. A conversa começa na primeira.">
            <ol className="space-y-3">
              {f.stages.map((s, i) => (
                <EtapaCard key={s.id} s={s} i={i} total={f.stages.length} stages={f.stages}
                  onChange={(p) => setStage(s.id, p)}
                  onMove={(d) => { const arr = [...f.stages]; const [x] = arr.splice(i, 1); arr.splice(i + d, 0, x); set({ stages: arr }); }}
                  onRemove={() => set({ stages: f.stages.filter((x) => x.id !== s.id).map((x) => ({ ...x, transitions: x.transitions.filter((t) => t.to !== s.id) })) })} />
              ))}
            </ol>
            {f.stages.length < AGENT_MAX_STAGES && (
              <Button variant="ghost" size="sm" icon={<Plus size={13} />}
                onClick={() => set({ stages: [...f.stages, { id: novoId(), name: `Etapa ${f.stages.length + 1}`, goal: '', transitions: [], tools: [] }] })}>
                Etapa
              </Button>
            )}
          </Secao>

          <Secao titulo="O que a IA pode usar" texto="A IA só escolhe entre os itens marcados aqui, e só nas etapas onde a ferramenta está ligada. O sistema confere tudo antes de executar.">
            <Alvos f={f} cat={catalog.data} usadas={usadas} set={set} />
            <Field label="Máximo de respostas por conversa" hint="Ao atingir, a conversa vai para a saída “Não conseguiu” do bloco (leve para um humano). É o freio de custo.">
              <input type="number" min={1} max={100} className={cn(inputCls, 'w-32')} value={f.maxReplies} onChange={(e) => set({ maxReplies: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} />
            </Field>
          </Secao>
        </div>

        <Simulador id={id} stages={f.stages} cat={catalog.data} sujo={sujo} />
      </div>

      <ConfirmDialog
        open={apagar}
        title="Apagar agente"
        text={`Fluxos que usam "${f.name}" vão seguir pela saída “Não conseguiu” até você escolher outro agente.`}
        confirmLabel="Apagar"
        danger
        onClose={() => setApagar(false)}
        onConfirm={() => remove.mutateAsync(id).then(() => { toast.ok('Agente apagado.'); router.push('/agentes-ia'); }, (e) => toast.err(e))}
      />
    </PageShell>
  );
}

function Secao({ titulo, texto, children }: { titulo: string; texto: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink text-sm">{titulo}</h2>
        <p className="text-[12.5px] text-muted">{texto}</p>
      </div>
      {children}
    </section>
  );
}

function EtapaCard({ s, i, total, stages, onChange, onMove, onRemove }: {
  s: AgentStage; i: number; total: number; stages: AgentStage[];
  onChange: (p: Partial<AgentStage>) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const outras = stages.filter((x) => x.id !== s.id);
  const toggleTool = (t: AgentToolKey) => onChange({ tools: s.tools.includes(t) ? s.tools.filter((x) => x !== t) : [...s.tools, t] });
  return (
    <li className="rounded-xl border border-line bg-field/40 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="grid place-items-center w-6 h-6 rounded-full bg-accent text-white text-[12px] font-semibold shrink-0">{i + 1}</span>
        <input className={cn(inputCls, 'flex-1 min-w-0 font-medium')} value={s.name} onChange={(e) => onChange({ name: e.target.value })} maxLength={60} aria-label="Nome da etapa" />
        <button type="button" className="p-1 rounded text-muted hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => onMove(-1)} aria-label="Subir"><ArrowUp size={14} /></button>
        <button type="button" className="p-1 rounded text-muted hover:text-ink disabled:opacity-30" disabled={i === total - 1} onClick={() => onMove(1)} aria-label="Descer"><ArrowDown size={14} /></button>
        <button type="button" className="p-1 rounded text-muted hover:text-danger disabled:opacity-30" disabled={total === 1} onClick={onRemove} aria-label="Apagar etapa"><Trash2 size={14} /></button>
      </div>
      <Field label="O que a IA faz nesta etapa" hint={i === 0 ? 'A conversa começa aqui.' : undefined}>
        <textarea className={areaCls} value={s.goal} onChange={(e) => onChange({ goal: e.target.value })} maxLength={3000} placeholder="Descubra o que o contato precisa: produto, quantidade e se é para entrega ou retirada." />
      </Field>

      <div className="space-y-1.5">
        <p className="text-[12px] font-medium text-ink">Passa para outra etapa quando…</p>
        {s.transitions.map((t, k) => (
          <div key={k} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-muted">ir para</span>
            <select className={cn(inputCls, 'w-44')} value={t.to} onChange={(e) => onChange({ transitions: s.transitions.map((x, j) => (j === k ? { ...x, to: e.target.value } : x)) })}>
              {outras.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <span className="text-[12px] text-muted">quando</span>
            <input className={cn(inputCls, 'flex-1 min-w-48')} value={t.when} onChange={(e) => onChange({ transitions: s.transitions.map((x, j) => (j === k ? { ...x, when: e.target.value } : x)) })} maxLength={500} placeholder="o contato disse o que quer comprar" />
            <button type="button" className="p-1 text-faint hover:text-danger" onClick={() => onChange({ transitions: s.transitions.filter((_, j) => j !== k) })} aria-label="Remover"><X size={14} /></button>
          </div>
        ))}
        {outras.length ? (
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => onChange({ transitions: [...s.transitions, { to: outras[0].id, when: '' }] })}>Caminho</Button>
        ) : <p className="text-[12px] text-faint">Crie outra etapa para ligar um caminho.</p>}
        {!s.transitions.length && outras.length > 0 && <p className="text-[11.5px] text-faint">Sem caminho: a conversa fica nesta etapa até a IA concluir, transferir ou encerrar.</p>}
      </div>

      <div className="space-y-1.5">
        <p className="text-[12px] font-medium text-ink">Ferramentas nesta etapa</p>
        <div className="flex flex-wrap gap-1.5">
          {AGENT_TOOL_KEYS.map((t) => {
            const sempre = t === 'handoff';
            const on = sempre || s.tools.includes(t);
            return (
              <button key={t} type="button" disabled={sempre} onClick={() => toggleTool(t)} title={AGENT_TOOLS[t].desc}
                className={cn('rounded-full border px-2.5 py-1 text-[12px]', on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field', sempre && 'cursor-default')}>
                {AGENT_TOOLS[t].label}{sempre && ' (sempre)'}
              </button>
            );
          })}
        </div>
      </div>
    </li>
  );
}

function Checks<T extends string>({ itens, marcados, onChange, vazio }: { itens: { id: T; name: string }[]; marcados: T[]; onChange: (v: T[]) => void; vazio: string }) {
  if (!itens.length) return <p className="text-[12px] text-faint">{vazio}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {itens.map((x) => {
        const on = marcados.includes(x.id);
        return (
          <button key={x.id} type="button" onClick={() => onChange(on ? marcados.filter((y) => y !== x.id) : [...marcados, x.id])}
            className={cn('rounded-full border px-2.5 py-1 text-[12px]', on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>
            {x.name}
          </button>
        );
      })}
    </div>
  );
}

function Alvos({ f, cat, usadas, set }: { f: AiAgentConfig; cat: AgentCatalog; usadas: Set<AgentToolKey>; set: (p: Partial<AiAgentConfig>) => void }) {
  const t = f.targets;
  const setT = (p: Partial<AiAgentConfig['targets']>) => set({ targets: { ...t, ...p } });
  const campos = [
    ...Object.entries(CONTACT_FIELD_LABEL).map(([id, name]) => ({ id, name })),
    ...cat.customFields.map((l) => ({ id: `attribute:${l}`, name: l })),
  ];
  const aviso = (tool: AgentToolKey) => (!usadas.has(tool) ? ' (nenhuma etapa usa)' : '');
  // grupo de botões: <Field> é um <label>, e clicar no rótulo dispararia o primeiro botão
  const Grupo = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div className="space-y-1 text-sm">
      <p className="text-ink font-medium">{label}</p>
      {children}
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
  return (
    <div className="space-y-3">
      <Grupo label={`Departamentos para transferir${aviso('transfer_department')}`}>
        <Checks itens={cat.departments} marcados={t.departmentIds ?? []} onChange={(v) => setT({ departmentIds: v })} vazio="Nenhum departamento cadastrado." />
      </Grupo>
      <Grupo label={`Etiquetas que pode marcar${aviso('add_tag')}`}>
        <Checks itens={cat.tags} marcados={t.tagIds ?? []} onChange={(v) => setT({ tagIds: v })} vazio="Nenhuma etiqueta cadastrada." />
      </Grupo>
      <Grupo label={`Dados do contato que pode salvar${aviso('set_contact_field')}`}>
        <Checks itens={campos} marcados={t.contactFields ?? []} onChange={(v) => setT({ contactFields: v })} vazio="" />
      </Grupo>
      <Grupo label={`Motivos de encerramento${aviso('close')}`} hint="Sem motivo marcado, a IA pode encerrar sem motivo.">
        <Checks itens={cat.closeReasons} marcados={t.closeReasonIds ?? []} onChange={(v) => setT({ closeReasonIds: v })} vazio="Nenhum motivo de encerramento cadastrado." />
      </Grupo>
    </div>
  );
}

type SimMsg = { from: 'contact' | 'agent'; text: string; turn?: AgentTurn };

function descreve(a: AgentAction, cat: AgentCatalog) {
  const nome = (l: { id: string; name: string }[], id?: string) => l.find((x) => x.id === id)?.name ?? id ?? '';
  switch (a.tool) {
    case 'transfer_department': return `Transferir para ${nome(cat.departments, a.departmentId)}`;
    case 'handoff': return 'Chamar um atendente';
    case 'add_tag': return `Etiquetar: ${nome(cat.tags, a.tagId)}`;
    case 'set_contact_field': return `Salvar ${(CONTACT_FIELD_LABEL as Record<string, string>)[a.field] ?? a.field.replace(/^attribute:/, '')}: ${a.value}`;
    case 'close': return `Encerrar${a.closeReasonId ? ` (${nome(cat.closeReasons, a.closeReasonId)})` : ''}`;
  }
}

/** Conversa de teste com o agente SALVO. Nada é enviado nem executado; cada resposta consome uma interação. */
function Simulador({ id, stages, cat, sujo }: { id: string; stages: AgentStage[]; cat: AgentCatalog; sujo: boolean }) {
  const sim = useSimulateAgent();
  const [msgs, setMsgs] = useState<SimMsg[]>([]);
  const [texto, setTexto] = useState('');
  const [encerrado, setEncerrado] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const etapa = useMemo(() => [...msgs].reverse().find((m) => m.turn)?.turn?.stageId ?? stages[0]?.id, [msgs, stages]);
  const nomeEtapa = (sid?: string) => stages.find((s) => s.id === sid)?.name ?? sid;
  useEffect(() => { fim.current?.scrollIntoView({ block: 'nearest' }); }, [msgs]);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t || sim.isPending || encerrado) return;
    const lista: SimMsg[] = [...msgs, { from: 'contact', text: t }];
    setMsgs(lista);
    setTexto('');
    sim.mutate({ id, stageId: etapa, messages: lista.map((m) => ({ from: m.from, text: m.text })).filter((m) => m.text) }, {
      onSuccess: (turn) => {
        setMsgs((cur) => [...cur, { from: 'agent', text: turn.reply, turn }]);
        if (turn.actions.some((a) => a.tool === 'transfer_department' || a.tool === 'handoff' || a.tool === 'close')) setEncerrado(true);
      },
      onError: (err) => { toast.err(err); setMsgs((cur) => cur.slice(0, -1)); setTexto(t); },
    });
  }

  return (
    <aside className="rounded-2xl border border-line bg-panel flex flex-col lg:sticky lg:top-4 h-[min(640px,80vh)]">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-line">
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-ink text-sm">Testar agente</p>
          <p className="text-[11.5px] text-muted truncate">Etapa: {nomeEtapa(etapa)}</p>
        </div>
        <button type="button" className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-field" aria-label="Recomeçar" onClick={() => { setMsgs([]); setEncerrado(false); }}><RotateCcw size={14} /></button>
      </div>
      {sujo && <p className="mx-3 mt-2 rounded-lg bg-warn-soft text-warn-ink px-2.5 py-1.5 text-[12px]">Salve para testar as mudanças: o teste usa o agente salvo.</p>}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {!msgs.length && <p className="text-[12.5px] text-faint text-center mt-6 px-4">Escreva como se fosse o cliente. Nada é enviado no WhatsApp e nenhuma ação é executada. Cada resposta consome uma interação de IA.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={cn('flex flex-col', m.from === 'contact' ? 'items-start' : 'items-end')}>
            {m.text && <p className={cn('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-[13px]', m.from === 'contact' ? 'bg-field text-ink' : 'bg-accent text-white')}>{m.text}</p>}
            {m.turn && (
              <div className="max-w-[85%] mt-1 space-y-0.5 text-right">
                {m.turn.stageId !== (i > 1 ? msgs.slice(0, i).reverse().find((x) => x.turn)?.turn?.stageId ?? stages[0]?.id : stages[0]?.id) && (
                  <p className="text-[11px] text-accent-ink">→ etapa {nomeEtapa(m.turn.stageId)}</p>
                )}
                {m.turn.actions.map((a, k) => <p key={k} className="text-[11px] text-ok">⚙ {descreve(a, cat)}</p>)}
                {m.turn.rejected.map((r, k) => <p key={k} className="text-[11px] text-faint" title="O sistema recusou o pedido da IA">✕ {r}</p>)}
                {m.turn.done && <p className="text-[11px] text-muted">✓ atendimento concluído</p>}
              </div>
            )}
          </div>
        ))}
        {sim.isPending && <p className="text-right text-[12px] text-faint">digitando…</p>}
        {encerrado && <p className="text-center text-[12px] text-muted">A conversa saiu do agente. Recomece para testar de novo.</p>}
        <div ref={fim} />
      </div>
      <form onSubmit={enviar} className="flex gap-2 p-3 border-t border-line">
        <input className={cn(inputCls, 'flex-1 min-w-0')} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Mensagem do cliente" maxLength={2000} disabled={encerrado} />
        <Button type="submit" aria-label="Enviar" loading={sim.isPending} disabled={!texto.trim() || encerrado}><Send size={14} /></Button>
      </form>
    </aside>
  );
}
