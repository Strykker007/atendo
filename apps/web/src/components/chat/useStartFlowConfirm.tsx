'use client';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useStartFlow } from '@/lib/hooks';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';

/**
 * Disparo manual de fluxo com a regra da tarefa 1.5: robô pausado na conversa → a API responde
 * 409 `bot_paused`, a tela pede confirmação e, confirmado, dispara de novo com `resumeBot`
 * (a API retoma o robô e inicia o fluxo).
 */
export function useStartFlowConfirm() {
  const start = useStartFlow();
  const [pending, setPending] = useState<{ flowId: string; flowName: string; conversationId: string; okText: string } | null>(null);

  const run = (flow: { id: string; name: string }, conversationId: string, okText = `Fluxo "${flow.name}" iniciado`) =>
    start.mutateAsync({ flowId: flow.id, conversationId }).then(() => toast.ok(okText)).catch((e) => {
      if (e instanceof ApiError && e.code === 'bot_paused') return setPending({ flowId: flow.id, flowName: flow.name, conversationId, okText });
      toast.err(e);
    });

  const dialog = (
    <ConfirmDialog
      open={!!pending}
      title="Fluxo pausado nesta conversa"
      text={`Para iniciar "${pending?.flowName ?? ''}", os fluxos voltam a funcionar nesta conversa. Retomar e iniciar o fluxo?`}
      confirmLabel="Retomar e iniciar"
      onClose={() => setPending(null)}
      onConfirm={() => { if (!pending) return; return start.mutateAsync({ flowId: pending.flowId, conversationId: pending.conversationId, resumeBot: true }).then(() => toast.ok(`Fluxo retomado. ${pending.okText}`)).catch(toast.err); }}
    />
  );
  return { run, dialog, start };
}
