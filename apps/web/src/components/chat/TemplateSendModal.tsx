'use client';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useSendTemplate } from '@/lib/hooks';
import { TemplateFields, useTemplateChoice } from './TemplateFields';

/**
 * Template pelo composer: a janela de 24h da Meta fechou e só template aprovado reabre o
 * diálogo. Sai pelo número da conversa (`expectedNumberId` confere), como qualquer resposta.
 */
export function TemplateSendModal({ conversationId, numberId, onClose }: { conversationId: string; numberId: string; onClose: () => void }) {
  const choice = useTemplateChoice(numberId);
  const send = useSendTemplate(conversationId, numberId);
  // uma chave por abertura: clique duplo não manda duas vezes
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  async function enviar() {
    if (!choice.value) return;
    try {
      await send.mutateAsync({ template: choice.value, idempotencyKey });
      toast.ok('Template enviado. Quando o contato responder, a conversa volta ao normal.');
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title="Enviar template">
      <div className="space-y-4">
        <p className="text-sm text-muted">O contato não escreve há mais de 24h. Na API oficial só dá para retomar a conversa com um template aprovado pela Meta.</p>
        <TemplateFields choice={choice} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={enviar} disabled={!choice.valid} loading={send.isPending} loadingText="Enviando…">Enviar template</Button>
        </div>
      </div>
    </Modal>
  );
}
