'use client';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { useNumbers, type NumberItem } from '@/lib/hooks';

/** quanto tempo o alerta fica no topo depois da queda (a pausa repetida é de 24h) */
const ALERTA_MS = 24 * 3_600_000;

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** o WhatsApp derrubou e o número segue fora — o caso que precisa de atenção */
export const foiRemovido = (n: NumberItem) => !!n.waRemovedAt && n.status !== 'connected' && Date.now() - new Date(n.waRemovedAt).getTime() < ALERTA_MS;
export const emPausa = (n: NumberItem) => !!n.reconnectBlockedUntil && new Date(n.reconnectBlockedUntil).getTime() > Date.now();

/**
 * Explicação para o cliente de por que o número caiu (docs/04-providers-whatsapp.md). Escrita
 * para quem não é técnico: o primeiro reflexo é achar que o sistema falhou e reconectar na hora
 * — e reconectar em cima da queda é justamente o que costuma virar restrição da conta.
 */
export function WaRemovedExplanation({ number }: { number: NumberItem }) {
  const repetida = (number.waRemovedCount ?? 0) > 1;
  return (
    <div className="space-y-2 text-[13px] text-ink">
      <p>
        Em <b>{hora(number.waRemovedAt!)}</b> o <b>próprio WhatsApp encerrou a conexão</b> deste número com o sistema.
        Não foi uma falha do sistema nem alguém clicando em &quot;Desconectar&quot; aqui.
        {repetida && <> Esta é a <b>{number.waRemovedCount}ª queda em 24 horas</b> — sinal forte de que o WhatsApp está de olho no número.</>}
      </p>
      <p className="font-medium">Isso acontece por um destes motivos:</p>
      <ul className="list-disc pl-5 space-y-0.5">
        <li>alguém removeu o aparelho em <b>WhatsApp → Aparelhos conectados</b>, no celular do número;</li>
        <li>o WhatsApp considerou o uso suspeito: conexão não oficial (por QR Code), <b>contatos bloqueando ou denunciando</b> o número, ou conteúdo contra a política comercial dele (por exemplo, venda de medicamentos).</li>
      </ul>
      <p className="font-medium">O que fazer:</p>
      <ol className="list-decimal pl-5 space-y-0.5">
        <li>Abra o WhatsApp no celular do número e veja se aparece aviso de <b>restrição ou banimento</b>. Se aparecer, siga as instruções de lá — normalmente dá para pedir revisão.</li>
        <li>
          <b>Espere antes de reconectar</b>
          {number.reconnectBlockedUntil && emPausa(number) && <> — o recomendado é a partir de <b>{hora(number.reconnectBlockedUntil)}</b></>}.
          Reconectar logo em seguida é o que costuma transformar a queda em restrição da conta.
        </li>
        <li>Se voltar a cair, considere a <b>API oficial do WhatsApp (Meta)</b>, que não depende de QR Code.</li>
      </ol>
    </div>
  );
}

/** Card na tela Números. */
export function WaRemovedCard({ number }: { number: NumberItem }) {
  if (!foiRemovido(number)) return null;
  return (
    <div className="rounded-xl border border-danger/40 bg-danger-soft p-3 space-y-2">
      <p className="flex items-center gap-1.5 font-semibold text-sm text-danger-ink"><ShieldAlert size={16} /> O WhatsApp desconectou este número</p>
      <WaRemovedExplanation number={number} />
    </div>
  );
}

/** Faixa no topo de todas as telas enquanto um número derrubado pelo WhatsApp segue fora. */
export function WaRemovedBanner() {
  const numbers = useNumbers();
  const caidos = (numbers.data ?? []).filter((n) => n.isActive && foiRemovido(n));
  if (!caidos.length) return null;
  const nomes = caidos.map((n) => `"${n.label}" (+${n.phone})`).join(', ');
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-[13px] bg-danger text-white">
      <ShieldAlert size={16} className="shrink-0" />
      <span className="flex-1">O WhatsApp desconectou {caidos.length > 1 ? 'os números' : 'o número'} {nomes}. Não reconecte antes de ler o que fazer.</span>
      <Link href="/numeros" className="underline font-medium whitespace-nowrap">Entender o motivo</Link>
    </div>
  );
}
