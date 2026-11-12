'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MessageSquareOff, X } from 'lucide-react';
import { useNumbers, type NumberItem } from '@/lib/hooks';

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** conectado, enviando, mas nada volta — marcado pelo health check da API (whatsapp/receive-stall.ts) */
export const parouDeReceber = (n: NumberItem) => n.isActive && n.status === 'connected' && !!n.receiveStalledAt;

/**
 * Passo a passo para o cliente. O número aparece "Conectado" e envia — a primeira reação é não
 * acreditar que há algo errado. Por isso o texto explica o sintoma antes do conserto.
 */
export function ReceiveStalledCard({ number }: { number: NumberItem }) {
  if (!parouDeReceber(number)) return null;
  return (
    <div className="rounded-xl border border-line bg-field p-3 space-y-2 text-[13px] text-ink">
      <p className="flex items-center gap-1.5 font-semibold text-sm text-ink"><MessageSquareOff size={15} className="text-muted" /> Mensagens recebidas não estão chegando</p>
      <p>
        Desde <b>{hora(number.receiveStalledAt!)}</b> as mensagens enviadas saem normalmente, mas as dos contatos não estão chegando ao
        painel. É uma falha na conexão com o sistema, não no WhatsApp, e nada foi apagado.
      </p>
      <p className="font-medium">Para resolver:</p>
      <ol className="list-decimal pl-5 space-y-0.5">
        <li>Clique em <b>Reiniciar conexão</b> neste número e, depois de 1 minuto, peça para alguém mandar uma mensagem para ele. Se aparecer no painel, está resolvido.</li>
        <li>
          Se não aparecer, conecte de novo (2 minutos, com o celular do número em mãos): <b>Desconectar</b>, depois <b>Conectar (QR)</b>, e leia o
          código no celular em <b>WhatsApp → Aparelhos conectados → Conectar aparelho</b>.
        </li>
      </ol>
      <p className="text-muted">
        As conversas e o histórico continuam. O que os contatos mandaram nesse intervalo fica no celular do número.
      </p>
      {!number.manageable && <p className="text-muted">Você não gerencia a conexão deste número: peça ao administrador da conta.</p>}
    </div>
  );
}

const OCULTO_KEY = 'atendo-aviso-sem-receber';
/** ocorrência = número + quando foi marcado: ocultar vale só para esta; uma nova volta a aparecer */
const ocorrencia = (n: NumberItem) => `${n.id}@${n.receiveStalledAt}`;

/**
 * Faixa no topo de todas as telas: quem atende precisa saber que mensagens não estão chegando.
 * Dá para ocultar (neste navegador) até uma nova ocorrência; o passo a passo continua em Números.
 * Some sozinha quando o número volta a receber (a API desmarca na primeira mensagem que chega).
 */
export function ReceiveStalledBanner() {
  const numbers = useNumbers();
  const [ocultos, setOcultos] = useState<string[]>([]);
  useEffect(() => {
    try { setOcultos(JSON.parse(localStorage.getItem(OCULTO_KEY) ?? '[]')); } catch { /* storage bloqueado */ }
  }, []);
  const parados = (numbers.data ?? []).filter((n) => parouDeReceber(n) && !ocultos.includes(ocorrencia(n)));
  if (!parados.length) return null;
  const ocultar = () => {
    // guarda só as ocorrências ainda ativas: a lista não cresce para sempre
    const novos = (numbers.data ?? []).filter(parouDeReceber).map(ocorrencia);
    setOcultos(novos);
    try { localStorage.setItem(OCULTO_KEY, JSON.stringify(novos)); } catch { /* storage bloqueado */ }
  };
  const nomes = parados.map((n) => `"${n.label}"`).join(', ');
  return (
    <div className="flex items-center gap-2 px-4 py-1 text-[12.5px] bg-field text-muted border-b border-line">
      <MessageSquareOff size={14} className="shrink-0" />
      <span className="flex-1">{parados.length > 1 ? 'Os números' : 'O número'} {nomes} {parados.length > 1 ? 'não estão' : 'não está'} recebendo mensagens no painel.</span>
      <Link href="/numeros" className="underline whitespace-nowrap text-ink">Como resolver</Link>
      <button type="button" onClick={ocultar} className="p-0.5 rounded hover:bg-panel" title="Ocultar este aviso (volta se acontecer de novo)" aria-label="Ocultar aviso"><X size={14} /></button>
    </div>
  );
}
