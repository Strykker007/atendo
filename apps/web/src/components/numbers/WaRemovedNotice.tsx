'use client';
import Link from 'next/link';
import { ShieldAlert, Unplug } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNumbers, type NumberItem } from '@/lib/hooks';

/** quanto tempo o alerta fica no topo depois da queda (a pausa repetida é de 24h) */
const ALERTA_MS = 24 * 3_600_000;

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** o WhatsApp derrubou e o número segue fora — o caso que precisa de atenção */
export const foiRemovido = (n: NumberItem) => !!n.waRemovedAt && n.status !== 'connected' && Date.now() - new Date(n.waRemovedAt).getTime() < ALERTA_MS;
export const emPausa = (n: NumberItem) => !!n.reconnectBlockedUntil && new Date(n.reconnectBlockedUntil).getTime() > Date.now();
/** 2ª queda (ou mais) em 24h: aí sim o risco de restrição é real e o aviso fica forte */
export const quedaRepetida = (n: NumberItem) => (n.waRemovedCount ?? 0) > 1;

/**
 * Explicação para o cliente de por que o número caiu (docs/04-providers-whatsapp.md#queda-pelo-whatsapp).
 * Escrita para quem não é técnico e **sem alarde na primeira queda**: na maioria das vezes é
 * aparelho removido, celular sem internet ou sessão vencida (prod, 30 dias até 12/11/2026: 22 de
 * 29 quedas voltaram normalmente). O texto antigo falava em banimento logo de cara e assustava.
 * O que segue valendo: não reconectar várias vezes seguidas — na repetição o tom muda.
 */
export function WaRemovedExplanation({ number }: { number: NumberItem }) {
  const repetida = quedaRepetida(number);
  const pausa = number.reconnectBlockedUntil && emPausa(number) ? hora(number.reconnectBlockedUntil) : null;
  if (!repetida) {
    return (
      <div className="space-y-2 text-[13px] text-ink">
        <p>
          Em <b>{hora(number.waRemovedAt!)}</b> a conexão deste número com o sistema foi encerrada pelo WhatsApp.
          <b> Isso é comum e quase sempre se resolve só reconectando.</b> As conversas continuam aqui.
        </p>
        <p className="font-medium">Causas mais comuns:</p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>o aparelho foi removido em <b>WhatsApp → Aparelhos conectados</b>, no celular do número;</li>
          <li>o celular ficou muito tempo sem internet ou desligado;</li>
          <li>o WhatsApp foi reinstalado ou trocado de celular.</li>
        </ul>
        <p className="font-medium">O que fazer:</p>
        <ol className="list-decimal pl-5 space-y-0.5">
          <li>Confira se o WhatsApp do celular está funcionando normalmente.</li>
          <li>
            Reconecte pelo QR Code{pausa && <> — de preferência a partir de <b>{pausa}</b></>}. Uma pausa curta antes de reconectar ajuda o
            WhatsApp a ver a conexão como normal.
          </li>
        </ol>
      </div>
    );
  }
  return (
    <div className="space-y-2 text-[13px] text-ink">
      <p>
        Esta é a <b>{number.waRemovedCount}ª vez em 24 horas</b> que o WhatsApp encerra a conexão deste número (a última em{' '}
        <b>{hora(number.waRemovedAt!)}</b>). Uma queda isolada é normal; <b>quedas seguidas pedem cuidado</b>, porque reconectar em
        cima delas pode levar o WhatsApp a restringir o número.
      </p>
      <p className="font-medium">Pode ser:</p>
      <ul className="list-disc pl-5 space-y-0.5">
        <li>alguém removendo o aparelho em <b>WhatsApp → Aparelhos conectados</b>;</li>
        <li>o WhatsApp desconfiando do uso: muitos contatos <b>bloqueando ou denunciando</b>, muitas mensagens para quem não responde, ou conteúdo contra a política comercial dele.</li>
      </ul>
      <p className="font-medium">O que fazer:</p>
      <ol className="list-decimal pl-5 space-y-0.5">
        <li>Abra o WhatsApp no celular do número e veja se aparece algum aviso. Se aparecer, siga as instruções de lá.</li>
        <li><b>Espere antes de reconectar</b>{pausa && <> — o recomendado é a partir de <b>{pausa}</b></>}.</li>
        <li>Se continuar caindo, fale com o suporte: a <b>API oficial da Meta</b> não depende de QR Code.</li>
      </ol>
    </div>
  );
}

/** Card na tela Números: amarelo na primeira queda, vermelho só na repetição. */
export function WaRemovedCard({ number }: { number: NumberItem }) {
  if (!foiRemovido(number)) return null;
  const forte = quedaRepetida(number);
  return (
    <div className={cn('rounded-xl border p-3 space-y-2', forte ? 'border-danger/40 bg-danger-soft' : 'border-warn/30 bg-warn-soft')}>
      <p className={cn('flex items-center gap-1.5 font-semibold text-sm', forte ? 'text-danger-ink' : 'text-warn-ink')}>
        {forte ? <ShieldAlert size={16} /> : <Unplug size={16} />} {forte ? 'Este número caiu várias vezes seguidas' : 'Número desconectado'}
      </p>
      <WaRemovedExplanation number={number} />
    </div>
  );
}

/** Faixa no topo de todas as telas enquanto um número derrubado pelo WhatsApp segue fora. */
export function WaRemovedBanner() {
  const numbers = useNumbers();
  const caidos = (numbers.data ?? []).filter((n) => n.isActive && foiRemovido(n));
  if (!caidos.length) return null;
  const forte = caidos.some(quedaRepetida);
  const nomes = caidos.map((n) => `"${n.label}"`).join(', ');
  return (
    <div className={cn('flex items-center gap-2 px-4 py-1.5 text-[13px]', forte ? 'bg-danger text-white' : 'bg-warn-soft text-warn-ink border-b border-warn/30')}>
      {forte ? <ShieldAlert size={16} className="shrink-0" /> : <Unplug size={16} className="shrink-0" />}
      <span className="flex-1">
        {caidos.length > 1 ? `Os números ${nomes} estão desconectados.` : `O número ${nomes} está desconectado.`}{' '}
        {forte ? 'Caiu várias vezes seguidas: veja o que fazer antes de reconectar.' : 'As conversas continuam aqui; é só reconectar.'}
      </span>
      <Link href="/numeros" className="underline font-medium whitespace-nowrap">{forte ? 'Ver o que fazer' : 'Reconectar'}</Link>
    </div>
  );
}
