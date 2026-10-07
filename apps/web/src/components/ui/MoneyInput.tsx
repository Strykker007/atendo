'use client';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/ui/Modal';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  /** casas decimais da máscara: 2 para preço, 3+ para valores unitários pequenos (R$ por mensagem) */
  decimals?: number;
  /** campo vazio vira `null` (ex.: "sem excedente"); sem isto vazio vira 0 */
  nullable?: boolean;
};

/**
 * Valor em R$ com máscara de caixa: os dígitos entram pela direita ("1" → 0,01, "1500" → 15,00)
 * e a exibição já sai com milhar e vírgula ("1.500,00"). Trabalha com número, nunca com texto.
 */
export function MoneyInput({ value, onChange, decimals = 2, nullable, className, placeholder, ...rest }: Props) {
  const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-faint">R$</span>
      <input
        {...rest}
        className={cn(inputCls, 'pl-9 text-right tnum')}
        inputMode="numeric"
        placeholder={placeholder ?? fmt(0)}
        value={value == null ? '' : fmt(value)}
        onChange={(e) => {
          // limita a 12 dígitos: acima disso o float perde centavos
          const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 12);
          if (!digits) return onChange(nullable ? null : 0);
          onChange(Number(digits) / 10 ** decimals);
        }}
      />
    </div>
  );
}
