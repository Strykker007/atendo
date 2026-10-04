'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState, useReactFlow, MarkerType, type Connection, type Edge, type Node, BackgroundVariant } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Save, ArrowLeft, Settings2, Activity, LayoutGrid, Copy, CopyPlus, ClipboardPaste, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Field, inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { nodeTypes, NODE_META, PALETTE_GROUPS, defaultData, FlowNodeActions, FlowEditorRefs, type FlowRefs, type ProviderKind } from './nodes';
import { NodePanel } from './NodePanel';
import { DeletableEdge } from './DeletableEdge';
import { autoLayout, looksVertical } from './layout';
import { collectFlowVars, SYSTEM_VARS } from './TextWithVars';
import { useHistory } from './history';
import { useUnsavedGuard } from '@/lib/unsaved-guard';
import { useNumbers, useFlowRuns, useFlows, useMe, useTags, type Flow } from '@/lib/hooks';
import { cloneFlowFragment, restoreFlowDefinition, scrubFlowDefinition, type FlowDefinition, type FlowEdge, type FlowNode, type FlowNodeType, type FlowTrigger } from '@atendo/shared';

const EMPTY: FlowDefinition = { nodes: [{ id: 'start', type: 'start', position: { x: 40, y: 200 }, data: {} as never }], edges: [] };
const edgeTypes = { deletable: DeletableEdge };
const EDGE_DEFAULTS = { type: 'deletable', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--line-strong)' }, style: { stroke: 'var(--line-strong)', strokeWidth: 2 } };

/**
 * Área de transferência dos cards. Fica no localStorage para o Ctrl+V funcionar em OUTRO
 * fluxo aberto (outra aba ou depois de navegar); a variável do módulo cobre o navegador que
 * bloqueia o storage. Guarda o desenho cru — os ids novos são gerados na hora de colar.
 * `tenantId` + nomes de etiquetas/fluxos: colar em OUTRA empresa (dono do sistema entrando
 * como clientes diferentes no mesmo navegador) passa pela mesma limpeza da importação.
 */
const CLIP_KEY = 'atendo.flow-clipboard';
type Clip = { nodes: FlowNode[]; edges: FlowEdge[]; tenantId?: string | null; tagNames?: Record<string, string>; flowNames?: Record<string, string> };
let memoryClip: Clip | null = null;
function writeClip(c: Clip) {
  memoryClip = c;
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(c)); } catch { /* storage bloqueado: fica só na memória */ }
}
function readClip(): Clip | null {
  try {
    const raw = localStorage.getItem(CLIP_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (Array.isArray(c?.nodes) && Array.isArray(c?.edges)) return c;
    }
  } catch { /* cai na memória */ }
  return memoryClip;
}
/** Foco num campo de texto: as teclas são do campo (desfazer/copiar o texto), não do canvas. */
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['TEXTAREA', 'SELECT'].includes(t.tagName) || (t instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(t.type)));

/** Editor visual de fluxo: paleta à esquerda, canvas no meio, propriedades à direita. */
/** 409 do PATCH /flows/:id quando outra pessoa (ou o sistema) salvou depois de o editor carregar. */
export const FLOW_VERSION_CONFLICT = 'flow_version_conflict';

export function FlowEditor(props: { flow: Partial<Flow>; onSave: (f: { name: string; description?: string; isActive: boolean; showInChat: boolean; trigger: FlowTrigger; definition: FlowDefinition }) => Promise<unknown>; saving: boolean }) {
  return <ReactFlowProvider><FlowEditorInner {...props} /></ReactFlowProvider>;
}

function FlowEditorInner({ flow, onSave, saving }: { flow: Partial<Flow>; onSave: (f: { name: string; description?: string; isActive: boolean; showInChat: boolean; trigger: FlowTrigger; definition: FlowDefinition }) => Promise<unknown>; saving: boolean }) {
  const rf = useReactFlow();
  const def = flow.definition ?? EMPTY;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(def.nodes.map(toRf));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(def.edges.map((e) => ({ ...e, ...EDGE_DEFAULTS, sourceHandle: e.sourceHandle ?? undefined, animated: false })));
  const canvasRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; flow: { x: number; y: number } } | null>(null);
  // desenho do tempo das ligações verticais: sugere organizar, sem mexer em nada sozinho
  const [vertical, setVertical] = useState(() => looksVertical(def.nodes.map(toRf), def.edges as Edge[]));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [meta, setMeta] = useState({
    name: flow.name ?? 'Novo fluxo',
    description: flow.description ?? '',
    isActive: flow.isActive ?? true,
    // fluxo novo: só vira atalho se for de disparo manual — os automáticos poluiriam a lista
    showInChat: flow.showInChat ?? (flow.trigger?.type ?? 'manual') === 'manual',
    trigger: flow.trigger ?? ({ type: 'manual' } as FlowTrigger),
  });
  const [side, setSide] = useState<'node' | 'settings' | 'runs'>('settings');
  const [dirty, setDirty] = useState(false);
  const numbers = useNumbers();
  const runs = useFlowRuns(flow.id ?? null);
  const flows = useFlows();
  const me = useMe();
  const tags = useTags();
  // links assinados dos anexos: os que vieram com o fluxo + os enviados nesta edição
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>(flow.mediaUrls ?? {});
  const refs = useMemo<FlowRefs>(() => {
    const kinds = [...new Set((numbers.data ?? []).map((n) => n.provider))] as ProviderKind[];
    return {
      flowId: flow.id,
      flows: flows.data,
      mediaUrl: (key) => (key ? mediaUrls[key] : undefined),
      rememberMedia: (key, url) => setMediaUrls((m) => ({ ...m, [key]: url })),
      // sem números carregados (ou nenhum cadastrado): avisa como se fossem os dois
      providers: kinds.length ? kinds : ['meta', 'evolution'],
    };
  }, [flow.id, flows.data, mediaUrls, numbers.data]);

  // "não salvo" = conteúdo (nós, arestas, config) diferente do último salvo. Medições do canvas não contam.
  const snapshot = useCallback(() => JSON.stringify({ n: nodes.map((n) => [n.id, n.type, Math.round(n.position.x), Math.round(n.position.y), n.data]), e: edges.map((e) => [e.source, e.sourceHandle ?? null, e.target]), meta }), [nodes, edges, meta]);
  const snap = useMemo(() => snapshot(), [snapshot]);
  const saved = useRef<string | null>(null);
  useEffect(() => {
    if (saved.current === null) { saved.current = snap; return; }
    setDirty(snap !== saved.current);
  }, [snap]);
  const guard = useUnsavedGuard(dirty);

  // Desfazer/refazer: fotos de nós + ligações + configurações (ver history.ts)
  const restore = useCallback((s: { nodes: Node[]; edges: Edge[]; meta: typeof meta }) => {
    setNodes(s.nodes.map((n) => ({ ...n, selected: false })));
    setEdges(s.edges.map((e) => ({ ...e, selected: false })));
    setMeta(s.meta);
  }, [setNodes, setEdges]);
  const undoStack = useHistory({ nodes, edges, meta }, snap, restore, nodes.some((n) => n.dragging));

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId), [nodes, selectedId]);
  // o card aberto no painel sumiu (desfazer a criação dele, por exemplo): volta para as configurações
  useEffect(() => {
    if (selectedId && !selected) { setSelectedId(null); setSide((sd) => (sd === 'node' ? 'settings' : sd)); }
  }, [selectedId, selected]);
  const flowVars = useMemo(() => collectFlowVars(nodes as { id: string; type: string; data: Record<string, unknown> }[]), [nodes]);

  const onConnect = useCallback((c: Connection) => {
    // uma saída (source+handle) só liga a um destino: substitui a anterior
    setEdges((eds) => addEdge({ ...c, ...EDGE_DEFAULTS, id: `e-${c.source}-${c.sourceHandle ?? 'out'}-${c.target}` }, eds.filter((e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)))));
  }, [setEdges]);

  /** Adiciona um bloco: por clique (abaixo do último) ou por drag-and-drop (na posição solta). */
  const addNode = (type: FlowNodeType, position?: { x: number; y: number }) => {
    const id = newNodeId(type);
    const last = nodes[nodes.length - 1];
    // por clique: à direita do último, que é para onde o fluxo cresce
    const pos = position ?? { x: (last?.position.x ?? 0) + 300, y: last?.position.y ?? 200 };
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

  // ---------- copiar / colar cards ----------

  /** Selecionados (clique + Shift ou seleção por área); sem seleção múltipla, o card aberto no painel. */
  const selectedNodes = () => {
    const sel = nodes.filter((n) => n.selected && n.type !== 'start');
    if (sel.length) return sel;
    const one = nodes.find((n) => n.id === selectedId && n.type !== 'start');
    return one ? [one] : [];
  };

  const copy = () => {
    const sel = selectedNodes();
    if (!sel.length) return toast.err('Selecione um ou mais cards para copiar (o Início não é copiado).');
    const ids = new Set(sel.map((n) => n.id));
    writeClip({
      nodes: sel.map(fromRf),
      // só as ligações entre os copiados; as que saem para fora da seleção ficam para trás
      edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target })),
      tenantId: me.data?.tenantId,
      tagNames: Object.fromEntries((tags.data ?? []).map((t) => [t.id, t.name])),
      flowNames: Object.fromEntries((flows.data ?? []).map((f) => [f.id, f.name])),
    });
    toast.ok(sel.length === 1 ? 'Card copiado — Ctrl+V cola aqui ou em outro fluxo' : `${sel.length} cards copiados — Ctrl+V cola aqui ou em outro fluxo`);
  };

  /**
   * Cola com ids novos. `at` (menu de contexto) = canto superior esquerdo no ponto clicado;
   * sem ele, abaixo dos originais (mesmo fluxo) ou no centro da tela (outro fluxo). Em
   * qualquer caso desce até não encostar em nenhum card que já está no canvas.
   */
  const w = (n: { id: string }) => nodes.find((x) => x.id === n.id)?.measured?.width ?? 220;
  const h = (n: { id: string }) => nodes.find((x) => x.id === n.id)?.measured?.height ?? 110;
  /** Desce o deslocamento de 60 em 60 até nenhum card do grupo encostar nos que já estão no canvas. */
  const freeOffset = (group: FlowNode[], start: { x: number; y: number }) => {
    const overlaps = (dx: number, dy: number) => group.some((c) => {
      const a = { x: c.position.x + dx, y: c.position.y + dy, w: w(c), h: h(c) };
      return nodes.some((n) => a.x < n.position.x + (n.measured?.width ?? 220) && a.x + a.w > n.position.x && a.y < n.position.y + (n.measured?.height ?? 110) && a.y + a.h > n.position.y);
    });
    let offset = start;
    for (let i = 0; i < 60 && overlaps(offset.x, offset.y); i++) offset = { x: offset.x, y: offset.y + 60 };
    return offset;
  };

  const paste = (at?: { x: number; y: number }) => {
    const clip = readClip();
    if (!clip?.nodes.length) return toast.err('Nada copiado ainda. Selecione cards e use Ctrl+C.');
    const minX = Math.min(...clip.nodes.map((n) => n.position.x));
    const minY = Math.min(...clip.nodes.map((n) => n.position.y));
    const maxY = Math.max(...clip.nodes.map((n) => n.position.y + h(n)));
    let origin: { x: number; y: number };
    if (at) origin = at;
    else if (clip.nodes.some((n) => nodes.some((x) => x.id === n.id))) origin = { x: minX, y: maxY + 60 };
    else {
      const r = canvasRef.current?.getBoundingClientRect();
      const c = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
      origin = { x: c.x - 110, y: c.y - 60 };
    }
    const offset = freeOffset(clip.nodes, { x: origin.x - minX, y: origin.y - minY });

    // veio de outra empresa: etiqueta por nome, o resto do que é do cliente sai marcado "Reconfigurar"
    let src: FlowDefinition = { nodes: clip.nodes, edges: clip.edges };
    const foreign = !!clip.tenantId && !!me.data?.tenantId && clip.tenantId !== me.data.tenantId;
    if (foreign) {
      const out = scrubFlowDefinition(src, { tagNameById: clip.tagNames, flowNameById: clip.flowNames });
      const back = restoreFlowDefinition(out.definition, Object.fromEntries((tags.data ?? []).map((t) => [t.name, t.id])));
      src = back.definition;
      [...out.warnings, ...back.warnings].forEach((w) => toast.err(w));
    }
    const frag = cloneFlowFragment(src.nodes, src.edges, { newId: newNodeId, offset });
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...frag.nodes.map((n) => ({ ...toRf(n), selected: true }))]);
    setEdges((es) => [...es, ...frag.edges.map((e) => ({ ...e, ...EDGE_DEFAULTS, sourceHandle: e.sourceHandle ?? undefined }))]);
    setSelectedId(null);
    setSide('settings');
    toast.ok(`${frag.nodes.length === 1 ? 'Card colado' : `${frag.nodes.length} cards colados`}${foreign ? ' — vieram de outra empresa: revise os marcados "Reconfigurar"' : ''}`);
  };

  /**
   * Duplica no próprio fluxo: mesma configuração, id novo, logo abaixo dos originais (ou mais
   * abaixo, se ali já houver card) e sem ligações — quem duplica liga onde quiser.
   */
  const duplicate = (ids: string[]) => {
    const src = nodes.filter((n) => ids.includes(n.id) && n.type !== 'start').map(fromRf);
    if (!src.length) return toast.err('Selecione um card para duplicar (o Início não é duplicado).');
    const minY = Math.min(...src.map((n) => n.position.y));
    const maxY = Math.max(...src.map((n) => n.position.y + h(n)));
    const frag = cloneFlowFragment(src, [], { newId: newNodeId, offset: freeOffset(src, { x: 0, y: maxY - minY + 40 }) });
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...frag.nodes.map((n) => ({ ...toRf(n), selected: true }))]);
    // um card só: já abre a cópia no painel, que é o que normalmente se edita em seguida
    if (frag.nodes.length === 1) { setSelectedId(frag.nodes[0].id); setSide('node'); }
    else { setSelectedId(null); setSide('settings'); }
  };
  const nodeActions = useMemo(() => ({ duplicate: (id: string) => keys.current.duplicate([id]) }), []);

  const removeSelection = () => {
    const ids = new Set(selectedNodes().map((n) => n.id));
    if (!ids.size) return;
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
    setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
    setSelectedId(null);
    setSide('settings');
  };

  // Ctrl/Cmd + C / V / D / Z / Y no canvas. Digitando num campo, a tecla é do texto (copiar,
  // desfazer a digitação…). Sem card selecionado / nada copiado, segue o normal do navegador.
  // Ctrl/Cmd + S salva em qualquer lugar do editor, inclusive digitando.
  const keys = useRef({ copy, paste, duplicate, save: () => {}, selectedIds: [] as string[] });
  keys.current = { copy, paste, duplicate, save: () => { if (!saving) save(); }, selectedIds: selectedNodes().map((n) => n.id) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // modal, menu ou lista aberta por cima (`data-overlay`): nenhum atalho do editor age por trás
      // (Ctrl+S só não deixa abrir o "salvar página" do navegador)
      if (document.querySelector('[data-overlay]')) { if (e.key.toLowerCase() === 's') e.preventDefault(); return; }
      // nunca o "salvar página" do navegador; tecla segurada não dispara vários saves
      if (e.key.toLowerCase() === 's') { e.preventDefault(); if (!e.repeat) keys.current.save(); return; }
      if (isTyping(e.target)) return;
      if (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y') {
        e.preventDefault();
        const redo = e.key.toLowerCase() === 'y' || e.shiftKey;
        (redo ? undoStack.redo : undoStack.undo)();
        return;
      }
      // texto selecionado na página (ex.: copiar um trecho do painel) também segue o normal
      if (e.key.toLowerCase() === 'c' && keys.current.selectedIds.length && !window.getSelection()?.toString()) { e.preventDefault(); keys.current.copy(); }
      // Ctrl+D é "favoritar" no navegador: só toma a tecla com card selecionado
      if (e.key.toLowerCase() === 'd' && keys.current.selectedIds.length) { e.preventDefault(); keys.current.duplicate(keys.current.selectedIds); }
      if (e.key.toLowerCase() === 'v' && readClip()?.nodes.length) { e.preventDefault(); keys.current.paste(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoStack.undo, undoStack.redo]);

  const openMenu = (e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    const r = canvasRef.current?.getBoundingClientRect();
    setMenu({ x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0), flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) });
  };

  const organize = () => {
    setNodes((ns) => autoLayout(ns, edges));
    setVertical(false);
    requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 300 }));
    toast.ok('Cards organizados da esquerda para a direita — salve para manter, ou saia sem salvar para descartar.');
  };

  async function save() {
    const definition: FlowDefinition = {
      nodes: nodes.map(fromRf),
      edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target })),
    };
    try {
      await onSave({ ...meta, description: meta.description || undefined, definition });
      saved.current = snapshot();
      setDirty(false);
      toast.ok('Fluxo salvo');
    } catch (err) {
      // versão desatualizada: a página mostra o aviso com "Recarregar"
      if (err instanceof ApiError && err.code === FLOW_VERSION_CONFLICT) return;
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
        {dirty
          ? <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5 bg-warn-soft text-warn-ink whitespace-nowrap" title="Ctrl+S salva">Alterações não salvas</span>
          : <span className="text-[11px] text-faint hidden sm:inline">salvo</span>}
        <Button size="sm" variant="ghost" icon={<LayoutGrid size={13} />} onClick={organize} title="Reposiciona os cards da esquerda para a direita a partir do Início">Organizar automaticamente</Button>
        <Button size="sm" variant="ghost" icon={<Settings2 size={13} />} onClick={() => setSide('settings')}>Gatilho</Button>
        {flow.id && <Button size="sm" variant="ghost" icon={<Activity size={13} />} onClick={() => setSide('runs')}>Execuções</Button>}
        <Button size="sm" icon={<Save size={13} />} loading={saving} loadingText="Salvando…" onClick={save} title="Ctrl+S">Salvar</Button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Paleta */}
        <aside className="w-44 shrink-0 border-r border-line bg-panel p-2 space-y-1 overflow-y-auto">
          {PALETTE_GROUPS.map((g) => (
            <div key={g.label} className="pb-1">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted px-1 py-1">{g.label}</div>
              {g.types.map((t) => {
                const m = NODE_META[t];
                return (
                  <button key={t} draggable onDragStart={(e) => onDragStart(e, t)} onClick={() => addNode(t)} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-field cursor-grab active:cursor-grabbing" title={`${m.hint} — clique ou arraste para o canvas`}>
                    <span className={cn('w-5 h-5 rounded-md grid place-items-center shrink-0', m.color)}>{m.icon}</span>
                    <span className="text-[12px] text-ink">{m.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
          <p className="text-[10.5px] text-faint px-1 pt-2">Clique ou <b>arraste</b> um bloco para o canvas; ligue a bolinha da direita de um card à da esquerda de outro. Delete remove o card ou a ligação selecionada.</p>
          <p className="text-[10.5px] text-faint px-1">Shift + clique ou Shift + arrastar seleciona vários; <b>Ctrl+C / Ctrl+V</b> copia e cola, inclusive em outro fluxo; <b>Ctrl+D</b> duplica; <b>Ctrl+Z</b> desfaz e <b>Ctrl+Shift+Z</b> (ou Ctrl+Y) refaz; <b>Ctrl+S</b> salva. No Mac, Cmd no lugar de Ctrl. A tesoura no meio de uma ligação a corta. Botão direito abre o menu.</p>
        </aside>

        {/* Canvas */}
        <div ref={canvasRef} className="flex-1 min-w-0 relative" onDragOver={onDragOver} onDrop={onDrop}>
          {vertical && (
            <div className="absolute z-10 top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-lg border border-line bg-panel shadow-sm px-3 py-1.5 text-[12px] text-ink">
              Este fluxo foi desenhado na vertical; as ligações agora saem pela lateral.
              <button className="font-semibold text-accent-ink hover:underline" onClick={organize}>Organizar automaticamente</button>
              <button className="text-faint hover:text-ink" onClick={() => setVertical(false)} title="Manter como está">×</button>
            </div>
          )}
          <FlowEditorRefs.Provider value={refs}>
          <FlowNodeActions.Provider value={nodeActions}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => { setSelectedId(n.id); setSide('node'); setMenu(null); }}
            onPaneClick={() => { setSelectedId(null); setMenu(null); if (side === 'node') setSide('settings'); }}
            onNodesDelete={(del) => { if (del.some((n) => n.id === selectedId)) { setSelectedId(null); setSide('settings'); } }}
            onNodeContextMenu={(e, n) => { if (!n.selected) { setNodes((ns) => ns.map((x) => ({ ...x, selected: x.id === n.id }))); setSelectedId(n.id); } openMenu(e); }}
            onSelectionContextMenu={openMenu}
            onPaneContextMenu={openMenu}
            onMoveStart={() => setMenu(null)}
            deleteKeyCode={['Backspace', 'Delete']}
            multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={EDGE_DEFAULTS}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line-strong)" />
            <Controls showInteractive={false} className="!bg-panel !border-line !shadow-sm [&>button]:!bg-panel [&>button]:!border-line [&>button]:!text-ink" />
            <MiniMap pannable zoomable className="!bg-panel !border-line" nodeColor={() => 'var(--line-strong)'} maskColor="color-mix(in srgb, var(--bg) 70%, transparent)" />
          </ReactFlow>
          </FlowNodeActions.Provider>
          </FlowEditorRefs.Provider>
          {menu && (
            <div data-overlay className="absolute z-20 min-w-44 rounded-lg border border-line bg-panel shadow-lg py-1 text-[13px]" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
              {selectedNodes().length > 0 && (
                <>
                  <button className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-field text-ink" onClick={() => { copy(); setMenu(null); }}><Copy size={13} /> Copiar <span className="ml-auto text-[11px] text-faint">Ctrl+C</span></button>
                  <button className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-field text-ink" onClick={() => { duplicate(selectedNodes().map((n) => n.id)); setMenu(null); }}><CopyPlus size={13} /> Duplicar <span className="ml-auto text-[11px] text-faint">Ctrl+D</span></button>
                </>
              )}
              <button className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-field text-ink disabled:text-faint" disabled={!readClip()?.nodes.length} onClick={() => { paste(menu.flow); setMenu(null); }}><ClipboardPaste size={13} /> Colar aqui <span className="ml-auto text-[11px] text-faint">Ctrl+V</span></button>
              {selectedNodes().length > 0 && (
                <button className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-field text-danger" onClick={() => { removeSelection(); setMenu(null); }}><Trash2 size={13} /> Excluir <span className="ml-auto text-[11px] text-faint">Delete</span></button>
              )}
            </div>
          )}
        </div>

        {/* Lateral direita */}
        <aside className="w-80 shrink-0 border-l border-line bg-panel overflow-hidden">
          {side === 'node' && selected && <FlowEditorRefs.Provider value={refs}><NodePanel node={{ id: selected.id, type: selected.type as FlowNodeType, position: selected.position, data: selected.data } as FlowNode} onChange={updateSelected} onDelete={deleteSelected} vars={flowVars} /></FlowEditorRefs.Provider>}
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
              <label className="flex items-start gap-2 text-ink">
                <input type="checkbox" className="mt-0.5" checked={meta.showInChat} onChange={(e) => setMeta({ ...meta, showInChat: e.target.checked })} />
                <span>
                  Atalho no chat
                  <span className="block text-[11px] text-muted">Aparece na aba Fluxos para o atendente disparar. Fluxo que roda sozinho não precisa.</span>
                </span>
              </label>

              <div className="pt-2 border-t border-line">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Variáveis disponíveis</div>
                <ul className="space-y-1">
                  {[...SYSTEM_VARS, ...flowVars].map((v) => (
                    <li key={v.key} className="flex items-baseline gap-2"><code className="font-mono text-[11.5px] bg-field rounded px-1 text-ink">{`{{${v.key}}}`}</code><span className="text-[11px] text-muted truncate">{v.label}</span></li>
                  ))}
                </ul>
                <p className="text-[11px] text-faint mt-1.5">Crie novas com os blocos <b>Salvar</b> e <b>Manipulador</b>. Use em qualquer texto pelo botão “Inserir variável”.</p>
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
      {guard.modal}
    </div>
  );
}

function toRf(n: FlowNode): Node {
  // o Início não sai pela tecla Delete: o fluxo precisa de exatamente um
  return { id: n.id, type: n.type, position: n.position, data: n.data as Record<string, unknown>, deletable: n.type !== 'start' };
}
function fromRf(n: Node): FlowNode {
  return { id: n.id, type: n.type as FlowNodeType, position: n.position, data: n.data } as FlowNode;
}
const newNodeId = (type: FlowNodeType) => `${type}-${crypto.randomUUID().slice(0, 6)}`;
