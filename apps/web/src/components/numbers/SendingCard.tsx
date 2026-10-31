'use client';
import { ShieldAlert, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { SEND_LIMIT_DEFAULTS, SEND_LIMIT_LABEL, SEND_LIMIT_RANGES, type SendLimits } from '@atendo/shared';
import { inputCls } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useMe, useUpdateNumber, type NumberItem, type SendDelayProfile } from '@/lib/hooks';

/** `fast` (1–2s) saiu: o mínimo no QR é 3s, para não arriscar banimento */
const DELAY_LABEL: Record<Exclude<SendDelayProfile, 'fast'>, string> = {
  instant: 'Imediato — só Meta Cloud API',
  short: 'Curto — 3 a 4s',
  moderate: 'Moderado — 3 a 6s',
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
  const oficial = number.provider === 'meta';
  // Tudo aqui é do dono do sistema (inclusive "entrando como" o cliente): ritmo de envio e
  // custo da linha. O cliente acelerando o intervalo queimava o próprio número. A API também
  // descarta esses campos para quem não é o dono.
  if (!(me.data?.role === 'super_admin' || me.data?.impersonatorId)) return null;

  return (
    <div className="rounded-lg bg-field/60 p-2.5 space-y-2 text-[12px]">
      <div className="flex items-center gap-1.5 text-muted font-medium">
        <ShieldAlert size={13} /> Proteção do número <span className="text-[10px] font-normal text-faint">(só o dono do sistema vê)</span>
      </div>

      {/* teto diário e aquecimento saíram da tela: número não tem mais limite de envios por dia */}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-faint leading-tight">Intervalo entre envios</span>
        <select
          className={cn(inputCls, 'h-9 py-0')}
          value={number.sendDelay === 'fast' ? 'moderate' : number.sendDelay}
          onChange={(e) => update.mutateAsync({ id: number.id, sendDelay: e.target.value as SendDelayProfile }).catch(toast.err)}
        >
          {(Object.keys(DELAY_LABEL) as (keyof typeof DELAY_LABEL)[])
            .filter((k) => k !== 'instant' || oficial)
            .map((k) => <option key={k} value={k}>{DELAY_LABEL[k]}</option>)}
        </select>
      </label>

      {/* Custo da linha: para o cliente, quanto a operação custa não é informação dele — e é
          esse número que faz a margem por cliente no Financeiro deixar de ser estimativa. */}
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

      {/* transmissão em massa no QR: teto por 24h móveis (docs/envio.md#transmissão); a Meta tem o tier dela */}
      {!oficial && (
        <label className="flex items-center gap-2">
          <span className="text-[11px] text-faint leading-tight flex-1">Teto de transmissão por 24h</span>
          <input
            type="number"
            min={0}
            max={5000}
            className={cn(inputCls, 'h-8 py-0 w-28 text-right')}
            defaultValue={number.campaignDailyLimit ?? 200}
            onBlur={(e) => {
              const v = Math.max(0, Math.min(5000, Math.round(Number(e.target.value))));
              if (v !== (number.campaignDailyLimit ?? 200)) update.mutateAsync({ id: number.id, campaignDailyLimit: v }).then(() => toast.ok('Teto de transmissão salvo')).catch(toast.err);
            }}
          />
        </label>
      )}

      {!oficial && <ColdLimit number={number} />}

      <QueueLimits number={number} />
    </div>
  );
}

/**
 * Trava de contatos novos por dia (docs/envio.md#envio-frio): quantos contatos que não escreveram
 * nas últimas 24 h o atendente pode chamar primeiro. Desmarcada = `coldPerDay: 0`, sem limite.
 * Automático (fluxo, boas-vindas) para contato frio continua recusado de qualquer jeito.
 */
function ColdLimit({ number }: { number: NumberItem }) {
  const update = useUpdateNumber();
  const atual = number.sendLimits ?? {};
  const padrao = SEND_LIMIT_DEFAULTS.evolution.coldPerDay;
  const ligada = atual.coldPerDay !== 0;

  function salvar(v: number | undefined, msg: string) {
    const next: Partial<SendLimits> = { ...atual };
    if (v === undefined) delete next.coldPerDay;
    else next.coldPerDay = v;
    update.mutateAsync({ id: number.id, sendLimits: Object.keys(next).length ? next : null }).then(() => toast.ok(msg)).catch(toast.err);
  }

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={ligada} onChange={(e) => salvar(e.target.checked ? undefined : 0, e.target.checked ? 'Trava de contatos novos ligada' : 'Trava de contatos novos desligada')} />
        <span className="text-[11px] text-faint leading-tight flex-1">Travar contatos novos por dia (falar primeiro com quem não escreveu em 24h)</span>
      </label>
      {ligada ? (
        <label className="flex items-center gap-2 pl-5">
          <span className="text-[11px] text-faint leading-tight flex-1">Contatos novos por dia</span>
          <input
            key={atual.coldPerDay ?? 'padrao'}
            type="number"
            min={1}
            max={SEND_LIMIT_RANGES.coldPerDay[1]}
            placeholder={`${padrao} (padrão)`}
            className={cn(inputCls, 'h-8 py-0 w-28 text-right')}
            defaultValue={atual.coldPerDay ?? ''}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const v = raw === '' ? undefined : Math.max(1, Math.min(SEND_LIMIT_RANGES.coldPerDay[1], Math.round(Number(raw))));
              if (v !== atual.coldPerDay) salvar(v, 'Limite salvo');
            }}
          />
        </label>
      ) : (
        <p className="pl-5 text-[11px] text-warn-ink">Sem limite: o atendente pode chamar quantos contatos quiser. O risco de bloqueio volta se muitos não responderem ou denunciarem.</p>
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
  const personalizados = Object.keys(atual).filter((k) => k !== 'coldPerDay').length;

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
          {/* contatos novos têm a própria trava (ColdLimit); no oficial é regra da Meta (template) */}
          {(Object.keys(SEND_LIMIT_RANGES) as (keyof SendLimits)[]).filter((k) => k !== 'coldPerDay').map((k) => (
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
          <p className="col-span-2 text-[11px] text-muted">Vazio = padrão da {number.provider === 'meta' ? 'Meta Cloud API' : 'Conexão Web'}. O excedente nunca é descartado: espera a vez.</p>
        </div>
      )}
    </div>
  );
}
