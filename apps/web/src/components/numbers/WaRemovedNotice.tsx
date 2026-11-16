'use client';
import Link from 'next/link';
import { Unplug } from 'lucide-react';
import { useNumbers, type NumberItem } from '@/lib/hooks';

/** quanto tempo o aviso fica no topo depois da queda (a pausa repetida é de 24h) */
const ALERTA_MS = 24 * 3_600_000;

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** o WhatsApp derrubou e o número segue fora */
export const foiRemovido = (n: NumberItem) => !!n.waRemovedAt && n.status !== 'connected' && Date.now() - new Date(n.waRemovedAt).getTime() < ALERTA_MS;
export const emPausa = (n: NumberItem) => !!n.reconnectBlockedUntil && new Date(n.reconnectBlockedUntil).getTime() > Date.now();
/** 2ª queda (ou mais) em 24h: a pausa sugerida é maior (24h) */
export const quedaRepetida = (n: NumberItem) => (n.waRemovedCount ?? 0) > 1;

/**
 * Explicação para o cliente de por que o número desconectou (docs/04-providers-whatsapp.md).
 * **Tom neutro de propósito, sempre**: nada de vermelho, "risco", "banimento", "restrição" ou
 * "denúncia". Os avisos alarmantes assustavam os clientes, e em 30 dias (até 12/11/2026) 22 de 29
 * quedas voltaram só reconectando. A orientação útil continua: esperar um pouco antes de reconectar.
 */
export function WaRemovedExplanation({ number }: { number: NumberItem }) {
  const pausa = number.reconnectBlockedUntil && emPausa(number) ? hora(number.reconnectBlockedUntil) : null;
  return (
    <div className="space-y-2 text-[13px] text-ink">
      <p>
        Em <b>{hora(number.waRemovedAt!)}</b> o WhatsApp encerrou a conexão deste número com o sistema. Isso é comum e se resolve
        reconectando pelo QR Code. As conversas continuam aqui.
      </p>
      <p className="text-muted">
        Costuma acontecer quando o aparelho é removido em <b>WhatsApp → Aparelhos conectados</b>, quando o celular fica muito tempo sem
        internet ou quando o WhatsApp é reinstalado.
      </p>
      <p className="text-muted">
        {pausa
          ? <>Sugerimos reconectar a partir de <b>{pausa}</b>: uma pausa antes de ler o QR deixa a conexão mais estável.</>
          : <>Antes de reconectar, confira se o WhatsApp do celular está funcionando normalmente.</>}
        {quedaRepetida(number) && <> Se continuar desconectando, fale com o suporte que a gente ajuda.</>}
      </p>
    </div>
  );
}

/** Card na tela Números: discreto, mesmo tom em qualquer caso. */
export function WaRemovedCard({ number }: { number: NumberItem }) {
  if (!foiRemovido(number)) return null;
  return (
    <div className="rounded-xl border border-line bg-field p-3 space-y-2">
      <p className="flex items-center gap-1.5 font-semibold text-sm text-ink"><Unplug size={15} className="text-muted" /> Número desconectado</p>
      <WaRemovedExplanation number={number} />
    </div>
  );
}

/** Faixa discreta no topo enquanto um número desconectado pelo WhatsApp segue fora. */
export function WaRemovedBanner() {
  const numbers = useNumbers();
  const caidos = (numbers.data ?? []).filter((n) => n.isActive && foiRemovido(n));
  if (!caidos.length) return null;
  const nomes = caidos.map((n) => `"${n.label}"`).join(', ');
  return (
    <div className="flex items-center gap-2 px-4 py-1 text-[12.5px] bg-field text-muted border-b border-line">
      <Unplug size={14} className="shrink-0" />
      <span className="flex-1">{caidos.length > 1 ? `Os números ${nomes} estão desconectados.` : `O número ${nomes} está desconectado.`}</span>
      <Link href="/numeros" className="underline whitespace-nowrap text-ink">Reconectar</Link>
    </div>
  );
}
