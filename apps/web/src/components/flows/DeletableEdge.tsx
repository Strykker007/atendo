'use client';
import { useRef, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { Scissors } from 'lucide-react';

/**
 * Ligação entre cards com botão de tesoura no meio, visível ao passar o mouse ou com a ligação
 * selecionada. A remoção passa pelo `deleteElements` do React Flow — o mesmo caminho da tecla
 * Delete —, então cai no `onEdgesChange` do editor e marca o fluxo como não salvo.
 *
 * O botão some com um pequeno atraso: ele fica em cima da linha, e sem isso passar o mouse
 * da linha para o botão fazia os dois brigarem (sai da linha → botão some → volta pra linha).
 */
export function DeletableEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style }: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [hover, setHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  const enter = () => { if (timer.current) clearTimeout(timer.current); setHover(true); };
  const leave = () => { timer.current = setTimeout(() => setHover(false), 150); };
  const active = hover || selected;

  return (
    <>
      <g onMouseEnter={enter} onMouseLeave={leave}>
        <BaseEdge path={path} markerEnd={markerEnd} interactionWidth={24} style={{ ...style, stroke: active ? 'var(--accent)' : style?.stroke, strokeWidth: active ? 2.5 : style?.strokeWidth }} />
      </g>
      {active && (
        <EdgeLabelRenderer>
          <button
            type="button"
            title="Cortar ligação (os cards ficam)"
            onMouseEnter={enter}
            onMouseLeave={leave}
            onClick={(e) => { e.stopPropagation(); deleteElements({ edges: [{ id }] }); }}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
            className="nodrag nopan absolute w-6 h-6 rounded-full grid place-items-center bg-panel border border-line-strong text-muted shadow-sm hover:bg-danger hover:border-danger hover:text-white"
          >
            <Scissors size={12} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
