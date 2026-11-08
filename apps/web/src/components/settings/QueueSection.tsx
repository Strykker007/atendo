'use client';
import { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import { QUEUE_MAX_PER_AGENT_LIMIT } from '@atendo/shared';
import { toast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { inputCls } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';
import { useTenantSettings, useUpdateTenantSettings } from '@/lib/hooks';
import { Regra } from './ClosingSection';

/**
 * Fila de atendimento com distribuição automática (docs/fila-de-atendimento.md): o sistema entrega
 * os contatos da fila, por ordem de chegada, para quem está disponível e abaixo do limite.
 */
export function QueueSection() {
  const settings = useTenantSettings();
  const update = useUpdateTenantSettings();
  const s = settings.data;
  const [max, setMax] = useState(4);
  useEffect(() => { if (s) setMax(s.autoDistributeMax); }, [s]);
  if (!s) return null;
  const valido = max >= 1 && max <= QUEUE_MAX_PER_AGENT_LIMIT;

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink flex items-center gap-1.5"><Inbox size={16} className="text-accent" /> Fila de atendimento</h2>
        <p className="text-sm text-muted">Um robô distribui: cada contato que chega vai para quem está disponível e tem menos atendimentos abertos, até o limite por pessoa. Quem chegou no limite só recebe depois de encerrar; enquanto todos estão cheios, o contato espera na fila.</p>
      </div>

      <Regra on={s.autoDistribute} disabled={update.isPending}
        onToggle={() => update.mutateAsync({ autoDistribute: !s.autoDistribute }).then(() => toast.ok(!s.autoDistribute ? 'Distribuição automática ligada' : 'Distribuição automática desligada')).catch(toast.err)}
        titulo="Distribuição automática"
        desc="Disponível = painel aberto, dentro do turno e fora de pausa, com acesso ao número e ao departamento da conversa. Empate entre quem tem menos atendimentos é sorteado." />

      {s.autoDistribute && (
        <div className="space-y-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted">Atendimentos abertos por pessoa</span>
              <input className={cn(inputCls, 'w-32 tnum')} type="number" min={1} max={QUEUE_MAX_PER_AGENT_LIMIT} value={max} onChange={(e) => setMax(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
            </label>
            {max !== s.autoDistributeMax && (
              <Button size="sm" disabled={!valido} loading={update.isPending} onClick={() => update.mutateAsync({ autoDistributeMax: max }).then(() => toast.ok(`Limite: ${max} por pessoa`)).catch(toast.err)}>Salvar limite</Button>
            )}
          </div>
          <p className="text-xs text-faint">Conta tudo que está com a pessoa e não foi encerrado (inclusive esperando o cliente responder). Grupos e contatos isentos não contam.</p>

          <Regra on={s.autoDistributeLockClaim} disabled={update.isPending}
            onToggle={() => update.mutateAsync({ autoDistributeLockClaim: !s.autoDistributeLockClaim }).then(() => toast.ok(!s.autoDistributeLockClaim ? 'Atendentes não puxam mais da fila' : 'Atendentes podem assumir da fila')).catch(toast.err)}
            titulo="Atendente não puxa da fila"
            desc="Divisão por igual: o atendente não assume nem responde contato da fila — só recebe pela distribuição. Gerente e administrador continuam podendo transferir." />

          <div className="rounded-xl bg-field px-4 py-3 text-xs text-muted space-y-1">
            <p>Cada pessoa marca <b className="text-ink">Disponível / Em pausa</b> no rodapé do menu (almoço, intervalo, reunião). Em pausa ela não recebe, mas continua com os atendimentos que já tem.</p>
            <p>Com a fila ligada, o bloco <b className="text-ink">Distribuidor</b> dos fluxos só coloca o contato na fila, e a redistribuição automática também respeita o limite.</p>
          </div>
        </div>
      )}
    </section>
  );
}
