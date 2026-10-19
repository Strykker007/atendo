'use client';
import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useRealtimeStatus } from '@/lib/hooks';

/** abaixo disto é oscilação normal (troca de rede, deploy rápido): não assusta ninguém */
const TOLERANCIA_MS = 8_000;

/**
 * Faixa no topo quando o tempo real cai: sem ela, mensagem nova simplesmente não aparecia e
 * ninguém sabia por quê. Some sozinha ao reconectar — e aí o painel recarrega o que perdeu
 * (`REALTIME_KEYS` em lib/hooks/numeros.ts).
 */
export function RealtimeBanner() {
  const downSince = useRealtimeStatus((s) => s.downSince);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!downSince) return;
    const t = setInterval(() => tick((n) => n + 1), 2_000);
    return () => clearInterval(t);
  }, [downSince]);
  if (!downSince || Date.now() - downSince < TOLERANCIA_MS) return null;
  return (
    <div role="status" className="flex items-center gap-2 px-4 py-1.5 text-[13px] bg-warn-soft text-warn-ink border-b border-warn">
      <WifiOff size={15} className="shrink-0" />
      <span className="flex-1">Sem conexão em tempo real — reconectando… Mensagens novas aparecem assim que voltar.</span>
      <button type="button" onClick={() => location.reload()} className="underline font-medium whitespace-nowrap">Recarregar</button>
    </div>
  );
}
