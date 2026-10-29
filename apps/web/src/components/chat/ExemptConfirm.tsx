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
      title={isento ? 'Voltar a entrar nos relatórios?' : 'Não gerar relatório para este número?'}
      text={isento
        ? `${nome} sai da lista de isentos. Os próximos atendimentos dele voltam a contar nos relatórios e a receber robô e pesquisa.`
        : `${nome} continua no atendimento normal — Aguardando, Atendendo, Encerrado, com dono — mas fica fora dos relatórios, não aciona robô nem pesquisa e encerra sem resultado. Nada muda no status agora. Use para diretoria, fornecedores e celulares da equipe.`}
      confirmLabel={isento ? 'Voltar a gerar relatório' : 'Não gerar relatório'}
      onConfirm={() => (isento ? remove.mutateAsync(conv.contact.id) : add.mutateAsync({ contactId: conv.contact.id }))
        .then(() => toast.ok(isento ? 'O número volta a entrar nos relatórios' : 'Número fora dos relatórios — a conversa continua onde está'))
        .catch((err) => { toast.err(err); throw err; })}
    />
  );
}
