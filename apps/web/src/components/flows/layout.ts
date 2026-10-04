import type { Edge, Node } from '@xyflow/react';

const COL = 320; // distância entre colunas (largura do card + espaço da ligação)
const GAP = 40; // espaço vertical entre cards da mesma coluna

/**
 * "Organizar automaticamente": camadas da esquerda para a direita a partir do Início.
 *
 * Coluna = distância (em ligações) até o Início, por busca em largura — assim um laço de
 * volta (menu → … → menu) não empurra o fluxo para o infinito. Dentro da coluna, cada card
 * fica na altura média de quem aponta para ele, na ordem das saídas (opção 1 acima da 2), o
 * que evita a maior parte dos cruzamentos. Cards soltos vão para uma coluna no fim.
 *
 * Só roda quando a pessoa clica: posição salva nunca muda sozinha.
 */
export function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  const out = new Map<string, Edge[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e]);

  const start = nodes.find((n) => n.type === 'start') ?? nodes[0];
  if (!start) return nodes;
  const depth = new Map<string, number>([[start.id, 0]]);
  const queue = [start.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of out.get(id) ?? []) {
      if (!depth.has(e.target)) { depth.set(e.target, depth.get(id)! + 1); queue.push(e.target); }
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, maxDepth + 1);

  const height = (n: Node) => n.measured?.height ?? 100;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const y = new Map<string, number>();
  const layers: Node[][] = [];
  for (const n of nodes) (layers[depth.get(n.id)!] ??= []).push(n);

  layers.forEach((layer, col) => {
    if (!layer) return;
    // altura desejada: média dos pais já posicionados (coluna anterior), mais a ordem da saída
    const wanted = (n: Node) => {
      const parents = edges.filter((e) => e.target === n.id && y.has(e.source) && depth.get(e.source)! < col);
      if (!parents.length) return Number.POSITIVE_INFINITY;
      return parents.reduce((s, e) => {
        const siblings = out.get(e.source) ?? [];
        return s + y.get(e.source)! + siblings.indexOf(e) * 0.01;
      }, 0) / parents.length;
    };
    const sorted = [...layer].sort((a, b) => wanted(a) - wanted(b) || a.position.y - b.position.y);
    const total = sorted.reduce((s, n) => s + height(n), 0) + GAP * (sorted.length - 1);
    let cursor = -total / 2;
    for (const n of sorted) {
      y.set(n.id, cursor);
      cursor += height(n) + GAP;
    }
  });

  return nodes.map((n) => ({ ...n, position: { x: depth.get(n.id)! * COL, y: y.get(n.id) ?? byId.get(n.id)!.position.y } }));
}

/**
 * O desenho parece do tempo das ligações verticais? (a maioria das ligações desce em vez de
 * ir para a direita). Serve só para sugerir o "Organizar automaticamente".
 */
export function looksVertical(nodes: Node[], edges: Edge[]): boolean {
  if (edges.length < 2) return false;
  const pos = new Map(nodes.map((n) => [n.id, n.position]));
  const down = edges.filter((e) => {
    const a = pos.get(e.source);
    const b = pos.get(e.target);
    return a && b && b.y - a.y > Math.abs(b.x - a.x);
  }).length;
  return down / edges.length > 0.5;
}
