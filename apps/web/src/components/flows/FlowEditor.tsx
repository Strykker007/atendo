'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState, useReactFlow, type Connection, type Edge, type Node, BackgroundVariant } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Save, ArrowLeft, Settings2, Activity } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Field, inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { nodeTypes, NODE_META, defaultData } from './nodes';
import { NodePanel } from './NodePanel';
import { collectFlowVars, SYSTEM_VARS } from './TextWithVars';
import { useNumbers, useFlowRuns, type Flow } from '@/lib/hooks';
import type { FlowDefinition, FlowNode, FlowNodeType, FlowTrigger } from '@atendo/shared';

const PALETTE: FlowNodeType[] = ['message', 'question', 'menu', 'ai', 'condition', 'action', 'schedule', 'wait', 'end'];
const EMPTY: FlowDefinition = { nodes: [{ id: 'start', type: 'start', position: { x: 250, y: 40 }, data: {} as never }], edges: [] };

/** Editor visual de fluxo: paleta à esquerda, canvas no meio, propriedades à direita. */
export function FlowEditor(props: { flow: Partial<Flow>; onSave: (f: { name: string; description?: string; isActive: boolean; trigger: FlowTrigger; definition: FlowDefinition }) => Promise<unknown>; saving: boolean }) {
  return <ReactFlowProvider><FlowEditorInner {...props} /></ReactFlowProvider>;
}

function FlowEditorInner({ flow, onSave, saving }: { flow: Partial<Flow>; onSave: (f: { name: string; description?: string; isActive: boolean; trigger: FlowTrigger; definition: FlowDefinition }) => Promise<unknown>; saving: boolean }) {
  const rf = useReactFlow();
  const def = flow.definition ?? EMPTY;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(def.nodes.map(toRf));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(def.edges.map((e) => ({ ...e, sourceHandle: e.sourceHandle ?? undefined, type: 'smoothstep', animated: false })));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [meta, setMeta] = useState({ name: flow.name ?? 'Novo fluxo', description: flow.description ?? '', isActive: flow.isActive ?? true, trigger: flow.trigger ?? ({ type: 'manual' } as FlowTrigger) });
  const [side, setSide] = useState<'node' | 'settings' | 'runs'>('settings');
  const [dirty, setDirty] = useState(false);
  const numbers = useNumbers();
  const runs = useFlowRuns(flow.id ?? null);

  // "não salvo" = conteúdo (nós, arestas, config) diferente do último salvo. Medições do canvas não contam.
  const snapshot = useCallback(() => JSON.stringify({ n: nodes.map((n) => [n.id, n.type, Math.round(n.position.x), Math.round(n.position.y), n.data]), e: edges.map((e) => [e.source, e.sourceHandle ?? null, e.target]), meta }), [nodes, edges, meta]);
  const saved = useRef<string | null>(null);
  useEffect(() => {
    if (saved.current === null) { saved.current = snapshot(); return; }
    setDirty(snapshot() !== saved.current);
  }, [snapshot]);

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId), [nodes, selectedId]);
  const flowVars = useMemo(() => collectFlowVars(nodes as { id: string; type: string; data: Record<string, unknown> }[]), [nodes]);

  const onConnect = useCallback((c: Connection) => {
    // uma saída (source+handle) só liga a um destino: substitui a anterior
    setEdges((eds) => addEdge({ ...c, id: `e-${c.source}-${c.sourceHandle ?? 'out'}-${c.target}`, type: 'smoothstep' }, eds.filter((e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)))));
  }, [setEdges]);

  /** Adiciona um bloco: por clique (abaixo do último) ou por drag-and-drop (na posição solta). */
  const addNode = (type: FlowNodeType, position?: { x: number; y: number }) => {
    const id = `${type}-${crypto.randomUUID().slice(0, 6)}`;
    const last = nodes[nodes.length - 1];
    const pos = position ?? { x: (last?.position.x ?? 200) + 40, y: (last?.position.y ?? 0) + 140 };
    setNodes((ns) => [...ns, { id, type, position: pos, data: defaultData(type) as Record<string, unknown> }]);
    setSelectedId(id);
    setSide('node');
  };
  const onDragStart = (e: React.DragEvent, type: FlowNodeType) => { e.dataTransfer.setData('application/atendo-node', type); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/atendo-node') as FlowNodeType;
    if (!type) return;
    // converte a posição do mouse (tela) para coordenadas do canvas (respeita zoom/pan)
    const position = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(type, { x: position.x - 100, y: position.y - 20 });
  };

  const updateSelected = (data: FlowNode['data']) => setNodes((ns) => ns.map((n) => (n.id === selectedId ? { ...n, data: data as Record<string, unknown> } : n)));
  const deleteSelected = () => { setNodes((ns) => ns.filter((n) => n.id !== selectedId)); setEdges((es) => es.filter((e) => e.source !== selectedId && e.target !== selectedId)); setSelectedId(null); setSide('settings'); };

  async function save() {
    const definition: FlowDefinition = {
      nodes: nodes.map((n) => ({ id: n.id, type: n.type as FlowNodeType, position: n.position, data: n.data }) as FlowNode),
      edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target })),
    };
    try {
      await onSave({ ...meta, description: meta.description || undefined, definition });
      saved.current = snapshot();
      setDirty(false);
      toast.ok('Fluxo salvo');
    } catch (err) {
      toast.err(err);
    }
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Barra superior */}
      <div className="h-12 shrink-0 flex items-center gap-3 px-3 border-b border-line bg-panel">
        <Link href="/fluxos" className="text-muted hover:text-ink"><ArrowLeft size={18} /></Link>
        <input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} className="font-display font-semibold text-ink bg-transparent focus:outline-none focus:bg-field rounded px-1 min-w-0 flex-1" />
        <span className={cn('text-[10.5px] font-semibold rounded-full px-2 py-0.5', meta.isActive ? 'bg-ok-soft text-ok' : 'bg-field text-muted')}>{meta.isActive ? 'Ativo' : 'Inativo'}</span>
        <span className="text-[11px] text-faint hidden sm:inline">{dirty ? 'alterações não salvas' : 'salvo'}</span>
        <Button size="sm" variant="ghost" icon={<Settings2 size={13} />} onClick={() => setSide('settings')}>Gatilho</Button>
        {flow.id && <Button size="sm" variant="ghost" icon={<Activity size={13} />} onClick={() => setSide('runs')}>Execuções</Button>}
        <Button size="sm" icon={<Save size={13} />} loading={saving} loadingText="Salvando…" onClick={save}>Salvar</Button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Paleta */}
        <aside className="w-44 shrink-0 border-r border-line bg-panel p-2 space-y-1 overflow-y-auto">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted px-1 py-1">Blocos</div>
          {PALETTE.map((t) => {
            const m = NODE_META[t];
            return (
              <button key={t} draggable onDragStart={(e) => onDragStart(e, t)} onClick={() => addNode(t)} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-field cursor-grab active:cursor-grabbing" title={`${m.hint} — clique ou arraste para o canvas`}>
                <span className={cn('w-5 h-5 rounded-md grid place-items-center shrink-0', m.color)}>{m.icon}</span>
                <span className="text-[12px] text-ink">{m.label}</span>
              </button>
            );
          })}
          <p className="text-[10.5px] text-faint px-1 pt-2">Clique ou <b>arraste</b> um bloco para o canvas; ligue as bolinhas para conectar. Delete remove o selecionado.</p>
        </aside>

        {/* Canvas */}
        <div className="flex-1 min-w-0 relative" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => { setSelectedId(n.id); setSide('node'); }}
            onPaneClick={() => { setSelectedId(null); if (side === 'node') setSide('settings'); }}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: 'smoothstep', style: { stroke: 'var(--line-strong)', strokeWidth: 2 } }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line-strong)" />
            <Controls showInteractive={false} className="!bg-panel !border-line !shadow-sm [&>button]:!bg-panel [&>button]:!border-line [&>button]:!text-ink" />
            <MiniMap pannable zoomable className="!bg-panel !border-line" nodeColor={() => 'var(--line-strong)'} maskColor="color-mix(in srgb, var(--bg) 70%, transparent)" />
          </ReactFlow>
        </div>

        {/* Lateral direita */}
        <aside className="w-80 shrink-0 border-l border-line bg-panel overflow-hidden">
          {side === 'node' && selected && <NodePanel node={{ id: selected.id, type: selected.type as FlowNodeType, position: selected.position, data: selected.data } as FlowNode} onChange={updateSelected} onDelete={deleteSelected} vars={flowVars} />}
          {side === 'settings' && (
            <div className="p-4 space-y-4 text-sm overflow-y-auto h-full">
              <div className="font-semibold text-ink">Configurações do fluxo</div>
              <Field label="Descrição"><input className={inputCls} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} placeholder="Para que serve" /></Field>
              <Field label="Gatilho">
                <select className={inputCls} value={meta.trigger.type} onChange={(e) => setMeta({ ...meta, trigger: { ...meta.trigger, type: e.target.value as FlowTrigger['type'] } })}>
                  <option value="manual">Manual — atendente dispara no chat</option>
                  <option value="new_conversation">Automático — toda conversa nova</option>
                  <option value="keyword">Automático — palavra-chave na mensagem</option>
                </select>
              </Field>
              {meta.trigger.type === 'keyword' && (
                <Field label="Palavras-chave" hint="Separe por vírgula. Ex.: promoção, catálogo"><input className={inputCls} value={(meta.trigger.keywords ?? []).join(', ')} onChange={(e) => setMeta({ ...meta, trigger: { ...meta.trigger, keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) } })} /></Field>
              )}
              {meta.trigger.type !== 'manual' && (
                <Field label="Só nestes números" hint="Nenhum marcado = todos">
                  <div className="space-y-1">
                    {numbers.data?.map((n) => {
                      const on = meta.trigger.numberIds?.includes(n.id);
                      return <label key={n.id} className="flex items-center gap-2 text-ink"><input type="checkbox" checked={!!on} onChange={(e) => setMeta({ ...meta, trigger: { ...meta.trigger, numberIds: e.target.checked ? [...(meta.trigger.numberIds ?? []), n.id] : (meta.trigger.numberIds ?? []).filter((x) => x !== n.id) } })} /> {n.label}</label>;
                    })}
                  </div>
                </Field>
              )}
              <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={meta.isActive} onChange={(e) => setMeta({ ...meta, isActive: e.target.checked })} /> Fluxo ativo</label>

              <div className="pt-2 border-t border-line">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Variáveis disponíveis</div>
                <ul className="space-y-1">
                  {[...SYSTEM_VARS, ...flowVars].map((v) => (
                    <li key={v.key} className="flex items-baseline gap-2"><code className="font-mono text-[11.5px] bg-field rounded px-1 text-ink">{`{{${v.key}}}`}</code><span className="text-[11px] text-muted truncate">{v.label}</span></li>
                  ))}
                </ul>
                <p className="text-[11px] text-faint mt-1.5">Crie novas com o bloco <b>Perguntar</b>. Use em qualquer texto pelo botão "Inserir variável".</p>
              </div>
              <p className="text-[11px] text-faint">Um fluxo inativo não dispara automaticamente nem aparece no painel do chat.</p>
            </div>
          )}
          {side === 'runs' && (
            <div className="p-4 space-y-3 text-sm overflow-y-auto h-full">
              <div className="font-semibold text-ink">Execuções</div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(runs.data?.byStatus ?? {}).map(([k, v]) => <div key={k} className="rounded-lg bg-field px-3 py-2"><div className="text-[10.5px] text-muted uppercase">{({ running: 'rodando', waiting: 'aguardando', done: 'concluídas', stopped: 'paradas', failed: 'falhas' } as Record<string, string>)[k] ?? k}</div><div className="text-lg font-semibold tnum text-ink">{v}</div></div>)}
                {!Object.keys(runs.data?.byStatus ?? {}).length && <p className="text-muted col-span-2">Nenhuma execução ainda.</p>}
              </div>
              <ul className="divide-y divide-line">
                {runs.data?.recent.map((r) => (
                  <li key={r.id} className="py-2 text-xs">
                    <div className="flex justify-between"><span className="font-medium text-ink">{r.contact.name ?? r.contact.phone}</span><span className={cn('rounded-full px-1.5', r.status === 'done' ? 'bg-ok-soft text-ok' : r.status === 'failed' ? 'bg-danger-soft text-danger-ink' : 'bg-field text-muted')}>{r.status}</span></div>
                    <div className="text-faint">{new Date(r.startedAt).toLocaleString('pt-BR')}{r.error && ` · ${r.error}`}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function toRf(n: FlowNode): Node {
  return { id: n.id, type: n.type, position: n.position, data: n.data as Record<string, unknown> };
}
