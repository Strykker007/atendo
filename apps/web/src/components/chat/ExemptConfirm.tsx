'use client';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { useAddIgnoredContact, useCan, useRemoveIgnoredByContact, type Conversation } from '@/lib/hooks';

/**
 * Atalho para isentar (ou deixar de isentar) o número da conversa — docs/contatos-isentos.md.
 * Fica na conversa aberta e no menu do card: era preciso ir até Configurações para cadastrar.
 * Mesma permissão da tela da lista (`settings.manage`). Grupo é sempre chat livre: não tem atalho.
 */
export function useExemptShortcut(conv: Pick<Conversation, 'ticketExempt' | 'contact'>) {
  const pode = useCan('settings.manage');
  return { pode: pode && !conv.contact.isGroup, isento: !!conv.ticketExempt };
}

export function ExemptConfirm({ conv, open, onClose }: { conv: Pick<Conversation, 'ticketExempt' | 'contact'>; open: boolean; onClose: () => void }) {
  const add = useAddIgnoredContact();
  const remove = useRemoveIgnoredByContact();
  const isento = !!conv.ticketExempt;
  const nome = conv.contact.name ?? `+${conv.contact.phone}`;
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={isento ? 'Voltar a abrir atendimento?' : 'Não abrir atendimento para este número?'}
      text={isento
        ? `${nome} sai da lista de isentos. A conversa livre é guardada como encerrada e a próxima mensagem dele abre atendimento normalmente.`
        : `${nome} vira conversa livre: as mensagens continuam chegando e podem ser respondidas, mas não entram na fila, não têm dono, não acionam robô e ficam fora dos relatórios. Use para diretoria, fornecedores e celulares da equipe.`}
      confirmLabel={isento ? 'Voltar a abrir atendimento' : 'Não abrir atendimento'}
      onConfirm={() => (isento ? remove.mutateAsync(conv.contact.id) : add.mutateAsync({ contactId: conv.contact.id }))
        .then(() => toast.ok(isento ? 'O número volta a abrir atendimento' : 'Número isento: fica em Conversas livres'))
        .catch((err) => { toast.err(err); throw err; })}
    />
  );
}
