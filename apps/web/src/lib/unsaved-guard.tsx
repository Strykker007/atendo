'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

/** Marca a entrada extra que o guarda empilha no histórico do navegador. */
const GUARD = '__unsavedGuard';
const atGuard = () => typeof window !== 'undefined' && !!(window.history.state as Record<string, unknown> | null)?.[GUARD];

/**
 * Protege uma tela com alterações não salvas. O App Router não tem evento de "vai trocar de
 * rota", então são três frentes:
 * - recarregar/fechar a aba: `beforeunload` (o navegador mostra o aviso padrão dele);
 * - clique em link interno (`<a>`, inclui o `next/link`): interceptado na captura, antes do
 *   React, e vira o modal de confirmação;
 * - botão Voltar: com alterações, empilha uma cópia da entrada atual (mesma URL). O Voltar cai
 *   nela em vez de sair; aí o modal decide entre ficar (empilha de novo) ou sair (volta mais um).
 *
 * Navegação feita por código (`router.push` em outro lugar) não passa por aqui — botões que
 * navegam usam `leaveTo(href)`, que abre o mesmo modal.
 */
export function useUnsavedGuard(dirty: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<{ kind: 'link'; href: string } | { kind: 'back' } | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // a entrada atual é a cópia do guarda? (sobrevive a remontar o editor na mesma URL)
  const onGuard = useRef(false);
  const path = useRef('');
  const leaving = useRef(false);

  const arm = useCallback(() => {
    if (atGuard()) return;
    window.history.pushState({ ...(window.history.state ?? {}), [GUARD]: true }, '', window.location.href);
    onGuard.current = true;
  }, []);

  useEffect(() => {
    path.current = window.location.pathname;
    onGuard.current = atGuard();
  }, []);

  useEffect(() => {
    if (dirty) arm();
  }, [dirty, arm]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || leaving.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onPop = () => {
      const fromGuard = onGuard.current;
      onGuard.current = atGuard();
      if (leaving.current || !fromGuard || window.location.pathname !== path.current) return;
      // saiu da cópia para a entrada real desta tela: era um Voltar
      if (dirtyRef.current) setPending({ kind: 'back' });
      else window.history.back(); // já salvou: a cópia só atrasaria o Voltar
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // só âncora/mesma tela
      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: 'link', href: url.pathname + url.search + url.hash });
    };
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('popstate', onPop);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('click', onClick, true);
    };
  }, []);

  /** Navegação por botão (ex.: Voltar do editor): com alterações, passa pelo mesmo modal. */
  const leaveTo = (href: string) => {
    if (dirtyRef.current) return setPending({ kind: 'link', href });
    leaving.current = true;
    // em cima da cópia: substitui, para o Voltar da próxima tela trazer de volta para cá
    if (atGuard()) router.replace(href);
    else router.push(href);
  };

  const stay = () => {
    if (pending?.kind === 'back') arm();
    setPending(null);
  };
  const leave = () => {
    const p = pending;
    setPending(null);
    leaving.current = true;
    if (p?.kind === 'back') window.history.back();
    // em cima da cópia: substitui, para o Voltar da próxima tela trazer de volta para cá
    else if (p && atGuard()) router.replace(p.href);
    else if (p) router.push(p.href);
  };

  const modal = (
    <Modal open={!!pending} onClose={stay} title="Alterações não salvas">
      <div className="space-y-4">
        <p className="text-sm text-ink">Você tem alterações não salvas. Deseja realmente sair sem salvar?</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={leave}>Sair sem salvar</Button>
          <Button onClick={stay}>Continuar editando</Button>
        </div>
      </div>
    </Modal>
  );
  return { modal, leaveTo };
}
