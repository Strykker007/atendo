import { cn } from '@/lib/utils';

/**
 * Logo horizontal (login, convite, recuperação de senha). Duas versões porque o "CHAT" é
 * preto e sumiria no cartão do tema escuro: a escura é a mesma arte com os pixels sem cor
 * clareados (o vermelho da marca fica intacto) — ver docs/08-frontend.md › Marca.
 */
export function MarcaHorizontal({ className }: { className?: string }) {
  return (
    <>
      <img src="/marca/vogo-horizontal.png" alt="VOGO.CHAT" className={cn('dark:hidden', className)} />
      <img src="/marca/vogo-horizontal-escuro.png" alt="VOGO.CHAT" className={cn('hidden dark:block', className)} />
    </>
  );
}
