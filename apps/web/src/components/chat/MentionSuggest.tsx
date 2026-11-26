'use client';
import { useMemo, useState } from 'react';
import { AtSign, Users } from 'lucide-react';
import { useAgents, useMe } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/** sem acento e minúsculo: "Laís" casa com "lais" (a API compara do mesmo jeito) */
const dobrar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type Opcao = { id: string; nome: string; inserir: string; todos?: boolean };

/**
 * Sugestão de @menção no campo da nota interna (docs/notas-internas.md#avisos): ao digitar "@",
 * lista a equipe ativa (e @todos) filtrando pelo que vem depois; setas escolhem, Enter/Tab insere,
 * Esc fecha. Insere o primeiro nome — ou o nome completo quando dois da equipe têm o mesmo primeiro
 * nome, senão o aviso iria para os dois.
 *
 * Uso: `const m = useMention(texto, setTexto, ref)`; no textarea, `onChange`/`onSelect` chamam
 * `m.sync`, `onKeyDown` chama `m.onKeyDown` primeiro (devolve true quando tratou a tecla) e
 * `m.popover` vai num contêiner `relative` em volta do campo.
 */
export function useMention(texto: string, setTexto: (v: string) => void, ref: React.RefObject<HTMLTextAreaElement | null>) {
  const agents = useAgents();
  const me = useMe().data;
  const [caret, setCaret] = useState(0);
  const [ativo, setAtivo] = useState(0);
  const [fechado, setFechado] = useState<number | null>(null);

  // "@xxx" imediatamente antes do cursor, começando no início ou depois de espaço
  const busca = useMemo(() => {
    const m = texto.slice(0, caret).match(/(^|\s)@([\p{L}\p{N}_.-]*)$/u);
    return m ? { termo: m[2], inicio: caret - m[2].length - 1 } : null;
  }, [texto, caret]);

  const opcoes = useMemo<Opcao[]>(() => {
    if (!busca || fechado === busca.inicio) return [];
    const equipe = (agents.data ?? []).filter((a) => a.isActive && a.id !== me?.id);
    const primeiro = (n: string) => n.trim().split(/\s+/)[0];
    const repetido = (n: string) => equipe.filter((a) => dobrar(primeiro(a.name)) === dobrar(primeiro(n))).length > 1;
    const q = dobrar(busca.termo);
    const lista: Opcao[] = equipe
      .filter((a) => !q || dobrar(a.name).split(/\s+/).some((p) => p.startsWith(q)) || dobrar(a.name).startsWith(q))
      .slice(0, 7)
      .map((a) => ({ id: a.id, nome: a.name, inserir: repetido(a.name) ? a.name.trim() : primeiro(a.name) }));
    if (!q || 'todos'.startsWith(q)) lista.push({ id: 'todos', nome: 'Todos', inserir: 'todos', todos: true });
    return lista;
  }, [busca, fechado, agents.data, me?.id]);

  const aberto = opcoes.length > 0;
  const sel = Math.min(ativo, opcoes.length - 1);

  const escolher = (o: Opcao) => {
    if (!busca) return;
    const antes = texto.slice(0, busca.inicio);
    const depois = texto.slice(caret).replace(/^[\p{L}\p{N}_.-]*/u, '');
    const novo = `${antes}@${o.inserir} ${depois.replace(/^\s+/, '')}`;
    const pos = antes.length + o.inserir.length + 2;
    setTexto(novo);
    setAtivo(0);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const sync = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart ?? el.value.length);
    if (fechado !== null) setFechado(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!aberto) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((sel + (e.key === 'ArrowDown' ? 1 : -1) + opcoes.length) % opcoes.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      escolher(opcoes[sel]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setFechado(busca?.inicio ?? null);
      return true;
    }
    return false;
  };

  const popover = aberto ? (
    <div role="listbox" aria-label="Mencionar alguém da equipe" className="absolute bottom-full left-0 mb-1.5 z-30 w-64 max-w-full rounded-xl border border-line bg-panel shadow-xl py-1 text-[13px]">
      <div className="px-3 pt-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Avisar quem? ↑↓ e Enter</div>
      {opcoes.map((o, i) => (
        <button key={o.id} type="button" role="option" aria-selected={i === sel}
          onMouseDown={(e) => { e.preventDefault(); escolher(o); }}
          onMouseEnter={() => setAtivo(i)}
          className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-left', i === sel ? 'bg-warn-soft text-ink' : 'text-ink hover:bg-field')}>
          {o.todos ? <Users size={14} className="text-warn-ink shrink-0" /> : <AtSign size={14} className="text-warn-ink shrink-0" />}
          <span className="truncate flex-1">{o.nome}</span>
          {o.todos && <span className="text-[10.5px] text-muted shrink-0">quem atende o número</span>}
        </button>
      ))}
    </div>
  ) : null;

  return { popover, onKeyDown, sync, aberto };
}
