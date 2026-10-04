'use client';
import { Zap } from 'lucide-react';
import { QUICK_REPLY_DELAY_MAX_SEC } from '@atendo/shared';
import { inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useTenantSettings, useUpdateTenantSettings } from '@/lib/hooks';

/**
 * Intervalo entre escolher uma resposta rápida e ela sair. Durante a contagem o atendente
 * pode cancelar ou editar — clicar na resposta errada não vira mensagem gasta.
 */
export function QuickReplySection() {
  const settings = useTenantSettings();
  const update = useUpdateTenantSettings();
  if (!settings.data) return null;
  const atual = settings.data.quickReplyDelaySec;

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-2">
      <div>
        <h3 className="font-display font-semibold text-ink flex items-center gap-2"><Zap size={16} /> Respostas rápidas</h3>
        <p className="text-sm text-muted mt-0.5">Ao escolher uma resposta rápida no chat, ela é enviada depois desta contagem, com botão para cancelar ou editar antes.</p>
      </div>
      <label className="flex items-center gap-2 text-[13px] text-ink">
        Enviar após
        <input
          type="number"
          min={0}
          max={QUICK_REPLY_DELAY_MAX_SEC}
          className={`${inputCls} w-20 text-right`}
          defaultValue={atual}
          onBlur={(e) => {
            const v = Math.round(Number(e.target.value));
            if (!Number.isFinite(v) || v === atual) return;
            update.mutateAsync({ quickReplyDelaySec: Math.min(QUICK_REPLY_DELAY_MAX_SEC, Math.max(0, v)) }).then(() => toast.ok('Configuração salva')).catch(toast.err);
          }}
        />
        segundos <span className="text-faint text-[12px]">(0 = envia na hora)</span>
      </label>
    </section>
  );
}
