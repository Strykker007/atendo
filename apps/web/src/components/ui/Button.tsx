'use client';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle' | 'success';
type Size = 'sm' | 'md' | 'icon';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent hover:bg-accent-hover text-white border border-transparent',
  ghost: 'border border-line text-ink hover:bg-field bg-panel',
  danger: 'bg-danger hover:bg-danger/90 text-white border border-transparent',
  subtle: 'border border-line text-danger hover:bg-danger-soft bg-panel',
  /** conclusão (ex.: Encerrar atendimento): verde para se destacar das ações neutras */
  success: 'bg-ok hover:bg-ok/90 text-white border border-transparent',
};
const SIZE: Record<Size, string> = {
  md: 'px-4 py-2 text-sm rounded-lg',
  sm: 'px-2.5 py-1.5 text-xs rounded-lg',
  icon: 'p-1 rounded-md',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Mostra spinner e desabilita. Use com `mutation.isPending`. */
  loading?: boolean;
  /** Texto exibido enquanto carrega (padrão: mantém o conteúdo) */
  loadingText?: string;
  icon?: React.ReactNode;
}

/**
 * Botão padrão do app. Toda ação que chama a API deve passar `loading` —
 * o usuário sempre vê que algo está acontecendo e não consegue clicar duas vezes.
 */
export function Button({ variant = 'primary', size = 'md', loading, loadingText, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn('inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed', VARIANT[variant], SIZE[size], className)}
    >
      {loading ? <Loader2 size={size === 'sm' || size === 'icon' ? 13 : 15} className="animate-spin shrink-0" /> : icon}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
