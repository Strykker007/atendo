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
    <div className="rounded-xl border border-danger/40 bg-danger-soft p-3 space-y-2 text-[13px] text-ink">
      <p className="flex items-center gap-1.5 font-semibold text-sm text-danger-ink"><MessageSquareOff size={16} /> Este número parou de receber mensagens</p>
      <p>
        Desde <b>{hora(number.receiveStalledAt!)}</b> as mensagens enviadas saem, mas <b>nenhuma mensagem de cliente chega</b> e nenhuma
        confirmação de entrega volta — mesmo aparecendo &quot;Conectado&quot;. A conexão com o WhatsApp perdeu a chave que abre as mensagens
        recebidas. Não é bloqueio do WhatsApp e nada foi apagado.
      </p>
      <p className="font-medium">Como resolver:</p>
      <ol className="list-decimal pl-5 space-y-0.5">
        <li>Clique em <b>Reiniciar conexão</b> neste número e, depois de 1 minuto, peça para alguém mandar uma mensagem para ele. Se a mensagem aparecer no painel, pronto — este aviso some em alguns minutos.</li>
        <li>
          Se não aparecer, a chave está estragada e só um pareamento novo resolve (2 minutos, com o celular do número em mãos): clique em <b>Desconectar</b>,
          depois em <b>Conectar (QR)</b>, e leia o código no celular em <b>WhatsApp → Aparelhos conectados → Conectar aparelho</b>. Teste de novo com uma mensagem.
        </li>
      </ol>
      <p className="text-muted">
        As conversas e o histórico continuam. As mensagens que os clientes mandaram enquanto o número estava assim <b>não aparecem depois</b> —
        confira no próprio celular quem escreveu nesse período.
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
  const nomes = parados.map((n) => `"${n.label}" (+${n.phone})`).join(', ');
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-[13px] bg-danger text-white">
      <MessageSquareOff size={16} className="shrink-0" />
      <span className="flex-1">{parados.length > 1 ? 'Os números' : 'O número'} {nomes} {parados.length > 1 ? 'pararam' : 'parou'} de receber mensagens de clientes. É preciso ler o QR de novo.</span>
      <Link href="/numeros" className="underline font-medium whitespace-nowrap">Como resolver</Link>
      <button type="button" onClick={ocultar} className="p-0.5 rounded hover:bg-white/15" title="Ocultar este aviso (volta se acontecer de novo)" aria-label="Ocultar aviso"><X size={15} /></button>
    </div>
  );
}
