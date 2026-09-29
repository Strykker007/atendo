'use client';
import { useState } from 'react';
import { Workflow, MessageCircleQuestion, CheckCircle2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useFlows, useHasFeature, useTenantSettings, useUpdateTenantSettings } from '@/lib/hooks';

/**
 * Fluxos que o cliente configura uma vez e valem para todos os números, sem precisar
 * criar gatilho em cada fluxo.
 */
export function DefaultFlowsSection() {
  const feature = useHasFeature('flows');
  const settings = useTenantSettings();
  const flows = useFlows();
  const update = useUpdateTenantSettings();
  const [texto, setTexto] = useState<string | null>(null);

  if (!feature.has || !settings.data) return null;
  const s = settings.data;
  const ativos = (flows.data ?? []).filter((f) => f.isActive);

  const salvar = (patch: Parameters<typeof update.mutateAsync>[0], msg = 'Configuração salva') =>
    update.mutateAsync(patch).then(() => toast.ok(msg)).catch(toast.err);

  const Select = ({ label, hint, icon, value, field }: { label: string; hint: string; icon: React.ReactNode; value: string | null; field: 'welcomeFlowId' | 'closedFlowId' | 'defaultFlowId' }) => (
    <div className="space-y-1 py-2.5 border-b border-line last:border-0">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink">{icon} {label}</div>
      <p className="text-[11.5px] text-muted">{hint}</p>
      <select
        className={`${inputCls} max-w-md`}
        value={value ?? ''}
        onChange={(e) => salvar({ [field]: e.target.value || null } as never)}
      >
        <option value="">Nenhum</option>
        {ativos.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
    </div>
  );

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-2">
      <div>
        <h3 className="font-display font-semibold text-ink flex items-center gap-2"><Workflow size={16} /> Fluxos padrão</h3>
        <p className="text-sm text-muted mt-0.5">Valem quando nenhum gatilho de palavra-chave casa. O que você configurou numa palavra específica sempre ganha destes.</p>
      </div>

      {ativos.length === 0 && <p className="text-[12px] text-warn-ink bg-warn-soft rounded-lg px-3 py-2">Nenhum fluxo ativo ainda. Crie um em <b>Fluxos</b> para poder escolher aqui.</p>}

      <Select
        field="welcomeFlowId"
        icon={<Sparkles size={14} className="text-accent" />}
        label="Boas-vindas"
        hint="Dispara na primeira mensagem de um contato que nunca conversou com você."
        value={s.welcomeFlowId}
      />
      <Select
        field="closedFlowId"
        icon={<CheckCircle2 size={14} className="text-ok" />}
        label="Conversa finalizada"
        hint="Dispara quando um contato volta a escrever depois de o atendimento ter sido encerrado."
        value={s.closedFlowId}
      />
      <Select
        field="defaultFlowId"
        icon={<MessageCircleQuestion size={14} className="text-c4" />}
        label="Resposta padrão"
        hint="Dispara em qualquer mensagem que não casou com palavra-chave — mas só após o período de inatividade abaixo, para o robô não falar por cima do atendente."
        value={s.defaultFlowId}
      />

      {s.defaultFlowId && (
        <label className="block space-y-1 pt-1">
          <span className="text-[12px] text-muted">Inatividade antes da resposta padrão (horas)</span>
          <input
            type="number"
            min={0}
            max={720}
            className={`${inputCls} max-w-[120px]`}
            defaultValue={s.defaultFlowInactivityHours}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v !== s.defaultFlowInactivityHours) salvar({ defaultFlowInactivityHours: v }, 'Período atualizado');
            }}
          />
          <span className="block text-[11px] text-faint">0 = responde sempre. O padrão (24h) evita que o robô interrompa um atendimento em andamento.</span>
        </label>
      )}

      <div className="pt-2 space-y-1">
        <span className="text-[12px] text-muted">Aviso de fora do expediente (opcional)</span>
        <textarea
          rows={2}
          className={inputCls}
          placeholder="Estamos fora do horário de atendimento. Respondemos assim que abrirmos!"
          defaultValue={s.outsideHoursText ?? ''}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => { if (texto !== null && texto !== (s.outsideHoursText ?? '')) salvar({ outsideHoursText: texto }, 'Aviso salvo'); }}
        />
        <span className="block text-[11px] text-faint">Enviado <b>uma vez por conversa</b>, só quando está fechado e nenhum fluxo assumiu. Repetir a cada mensagem irrita quem está esperando.</span>
      </div>
    </section>
  );
}
