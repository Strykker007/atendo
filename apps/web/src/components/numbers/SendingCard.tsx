'use client';
import { ShieldAlert, Flame, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { SEND_LIMIT_DEFAULTS, SEND_LIMIT_LABEL, SEND_LIMIT_RANGES, type SendLimits } from '@atendo/shared';
import { inputCls } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useMe, useSendingStatus, useUpdateNumber, type NumberItem, type SendDelayProfile } from '@/lib/hooks';

const DELAY_LABEL: Record<SendDelayProfile, string> = {
  instant: 'Imediato — só API oficial',
  fast: 'Rápido — 1 a 7s',
  short: 'Curto — 7 a 25s',
  medium: 'Médio — 25 a 60s',
  long: 'Longo — 60 a 250s',
};

/**
 * Proteção do número. Aparece no cartão de cada número porque é a configuração que
 * decide se o cliente mantém a linha dele ou toma bloqueio.
 */
export function SendingCard({ number }: { number: NumberItem }) {
  const me = useMe();
  const update = useUpdateNumber();
  const status = useSendingStatus(number.id);
  const oficial = number.provider === 'meta';
  const pct = status.data && status.data.limit > 0 ? Math.min(100, (status.data.sent / status.data.limit) * 100) : 0;

  const aquecendo = !!number.warmupStartedAt && !!status.data && status.data.limit < number.sendDailyLimit;

  return (
    <div className="rounded-lg bg-field/60 p-2.5 space-y-2 text-[12px]">
      <div className="flex items-center gap-1.5 text-muted font-medium">
        <ShieldAlert size={13} /> Proteção do número
      </div>

      {/* `items-end` alinha os campos pela base: o rótulo do teto diário quebra em duas
          linhas e, sem isso, um campo ficava mais baixo que o outro. A altura fixa iguala
          select e input, que têm alturas intrínsecas diferentes com a mesma classe. */}
      <div className="grid grid-cols-2 gap-2 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-faint leading-tight">Intervalo entre envios</span>
          <select
            className={cn(inputCls, 'h-9 py-0')}
            value={number.sendDelay}
            onChange={(e) => update.mutateAsync({ id: number.id, sendDelay: e.target.value as SendDelayProfile }).catch(toast.err)}
          >
            {(Object.keys(DELAY_LABEL) as SendDelayProfile[])
              .filter((k) => k !== 'instant' || oficial)
              .map((k) => <option key={k} value={k}>{DELAY_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-faint leading-tight">Máximo por dia (0 = sem teto)</span>
          <input
            type="number"
            min={0}
            className={cn(inputCls, 'h-9 py-0')}
            defaultValue={number.sendDailyLimit}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v !== number.sendDailyLimit) update.mutateAsync({ id: number.id, sendDailyLimit: v }).catch(toast.err);
            }}
          />
        </label>
      </div>

      {/* Custo da linha: só o dono do sistema vê e edita. Para o cliente, quanto a operação
          custa não é informação dele — e é esse número que faz a margem por cliente no
          Financeiro deixar de ser estimativa. */}
      {(me.data?.role === 'super_admin' || me.data?.impersonatorId) && (
        <label className="flex items-center gap-2">
          <span className="text-[11px] text-faint leading-tight flex-1">Custo mensal desta linha (R$)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            className={cn(inputCls, 'h-8 py-0 w-28 text-right')}
            defaultValue={Number(number.infraCostMonth ?? 0)}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v !== Number(number.infraCostMonth ?? 0)) update.mutateAsync({ id: number.id, infraCostMonth: v }).then(() => toast.ok('Custo da linha salvo')).catch(toast.err);
            }}
          />
        </label>
      )}

      {status.data && (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-muted">
            <span>Hoje: <b className="text-ink tnum">{status.data.sent}</b>{status.data.limit > 0 && <> de <span className="tnum">{status.data.limit}</span></>}</span>
            {!status.data.ok && <span className="text-danger">teto atingido</span>}
          </div>
          {status.data.limit > 0 && (
            <div className="h-1.5 rounded-full bg-line overflow-hidden">
              <div className={pct >= 100 ? 'h-full bg-danger' : pct >= 80 ? 'h-full bg-warn' : 'h-full bg-ok'} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}

      {aquecendo && (
        <p className="flex items-start gap-1.5 text-[11px] text-warn-ink bg-warn-soft rounded-md px-2 py-1.5">
          <Flame size={12} className="mt-0.5 shrink-0" />
          <span>Número em aquecimento: o teto sobe sozinho a cada dia até chegar no configurado. Número novo com volume alto é banido rápido.</span>
        </p>
      )}

      <QueueLimits number={number} />

      {!oficial && number.sendDelay === 'fast' && (
        <p className="text-[11px] text-muted">No número não oficial, intervalo curto de verdade é o que evita bloqueio. Use <b>Rápido</b> só para atendimento, nunca para disparo.</p>
      )}
    </div>
  );
}

/**
 * Limites da fila de envio desta conexão (docs/envio.md). Campo vazio = padrão do provider,
 * que aparece como placeholder. Fica recolhido: o padrão serve para quase todo mundo.
 */
function QueueLimits({ number }: { number: NumberItem }) {
  const update = useUpdateNumber();
  const [aberto, setAberto] = useState(false);
  const padrao = SEND_LIMIT_DEFAULTS[number.provider];
  const atual = number.sendLimits ?? {};
  const personalizados = Object.keys(atual).length;

  function salvar(k: keyof SendLimits, raw: string) {
    const v = raw.trim() === '' ? undefined : Number(raw);
    if (v === atual[k]) return;
    const next: Partial<SendLimits> = { ...atual };
    if (v === undefined) delete next[k];
    else next[k] = v;
    update.mutateAsync({ id: number.id, sendLimits: Object.keys(next).length ? next : null }).then(() => toast.ok('Limite salvo')).catch(toast.err);
  }

  return (
    <div>
      <button type="button" onClick={() => setAberto((a) => !a)} className="flex items-center gap-1 text-[11px] text-muted hover:text-ink">
        <ChevronDown size={12} className={cn('transition-transform', !aberto && '-rotate-90')} />
        Limites da fila de envio {personalizados > 0 ? `(${personalizados} personalizado${personalizados > 1 ? 's' : ''})` : '(padrão)'}
      </button>
      {aberto && (
        <div className="grid grid-cols-2 gap-2 mt-1.5 items-end">
          {(Object.keys(SEND_LIMIT_RANGES) as (keyof SendLimits)[]).map((k) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-[11px] text-faint leading-tight">{SEND_LIMIT_LABEL[k]}</span>
              <input
                type="number"
                min={SEND_LIMIT_RANGES[k][0]}
                max={SEND_LIMIT_RANGES[k][1]}
                placeholder={`${padrao[k]} (padrão)`}
                className={cn(inputCls, 'h-8 py-0')}
                defaultValue={atual[k] ?? ''}
                onBlur={(e) => salvar(k, e.target.value)}
              />
            </label>
          ))}
          <p className="col-span-2 text-[11px] text-muted">Vazio = padrão do {number.provider === 'meta' ? 'API oficial' : 'não oficial'}. O excedente nunca é descartado: espera a vez.</p>
        </div>
      )}
    </div>
  );
}
