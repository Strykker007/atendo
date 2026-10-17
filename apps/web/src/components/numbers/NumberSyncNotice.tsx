'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useNumbers, type NumberItem } from '@/lib/hooks';

/**
 * Quanto tempo depois de reconectar o painel avisa "sincronizando". O WhatsApp entrega o que
 * chegou enquanto o número estava fora em lotes, sem avisar quando terminou — a janela é a
 * estimativa de quando o grosso já chegou (docs/04-providers-whatsapp.md#sincronização).
 */
export const NUMBER_SYNC_NOTICE_MS = 10 * 60_000;

export const sincronizando = (n: NumberItem, now = Date.now()) =>
  n.isActive && n.status === 'connected' && !!n.syncStartedAt && now - new Date(n.syncStartedAt).getTime() < NUMBER_SYNC_NOTICE_MS;

/** Re-renderiza a cada 30 s enquanto há número sincronizando: o aviso some sozinho no fim da janela. */
function useSyncing() {
  const numbers = useNumbers();
  const [now, setNow] = useState(() => Date.now());
  const lista = (numbers.data ?? []).filter((n) => sincronizando(n, now));
  useEffect(() => {
    if (!lista.length) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [lista.length]);
  return lista;
}

/** Selo no card do número (tela Números). */
export function NumberSyncCard({ number }: { number: NumberItem }) {
  if (!sincronizando(number)) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-[12.5px] text-accent-ink">
      <RefreshCw size={14} className="shrink-0 mt-0.5 animate-spin [animation-duration:2.5s]" />
      <span>Sincronizando as mensagens de quando o número estava desconectado. Elas chegam aos poucos e podem levar alguns minutos.</span>
    </p>
  );
}

/** Faixa no topo de todas as telas logo depois de um número reconectar. Dá para fechar (vale para esta reconexão). */
export function NumberSyncBanner() {
  const lista = useSyncing();
  const [ocultos, setOcultos] = useState<string[]>([]);
  const visiveis = lista.filter((n) => !ocultos.includes(`${n.id}@${n.syncStartedAt}`));
  if (!visiveis.length) return null;
  const nomes = visiveis.map((n) => `"${n.label}"`).join(', ');
  return (
    <div role="status" className="flex items-center gap-2 px-4 py-1.5 text-[13px] bg-accent-soft text-accent-ink border-b border-accent/30">
      <RefreshCw size={15} className="shrink-0 animate-spin [animation-duration:2.5s]" />
      <span className="flex-1">
        {visiveis.length > 1 ? 'Os números' : 'O número'} {nomes} {visiveis.length > 1 ? 'reconectaram' : 'reconectou'} e {visiveis.length > 1 ? 'estão' : 'está'} sincronizando as mensagens recebidas enquanto {visiveis.length > 1 ? 'estavam' : 'estava'} fora. Elas aparecem aos poucos nos próximos minutos.
      </span>
      <button type="button" onClick={() => setOcultos(visiveis.map((n) => `${n.id}@${n.syncStartedAt}`))} className="p-0.5 rounded hover:bg-black/5" title="Ocultar" aria-label="Ocultar aviso"><X size={15} /></button>
    </div>
  );
}
