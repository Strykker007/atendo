'use client';
import { PenLine } from 'lucide-react';
import { toast } from '@/components/ui/Toast';
import { useTenantSettings, useUpdateTenantSettings } from '@/lib/hooks';
import { Regra } from './ClosingSection';

/**
 * Assinatura obrigatória: o nome do atendente vai na 1ª linha de toda mensagem (`*Nome:*`).
 * Ligada, o botão de assinar no chat fica travado e a API assina o que chegar sem nome.
 */
export function SignatureSection() {
  const settings = useTenantSettings();
  const update = useUpdateTenantSettings();
  if (!settings.data) return null;
  const on = settings.data.requireSignature;
  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink flex items-center gap-1.5"><PenLine size={16} className="text-accent" /> Assinatura do atendente</h2>
        <p className="text-sm text-muted">O nome de quem atende vai em negrito na primeira linha da mensagem, para o contato saber com quem fala.</p>
      </div>
      <Regra on={on} disabled={update.isPending}
        onToggle={() => update.mutateAsync({ requireSignature: !on }).then(() => toast.ok(!on ? 'Assinatura agora é obrigatória' : 'Assinatura agora é opcional')).catch(toast.err)}
        titulo="Assinatura obrigatória"
        desc={on ? 'Ligado: toda mensagem do atendente sai assinada; ninguém consegue desligar no chat.' : 'Desligado: cada atendente liga ou desliga no botão de assinar do chat.'} />
    </section>
  );
}
