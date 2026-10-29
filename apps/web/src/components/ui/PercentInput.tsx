'use client';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/ui/Modal';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onChange: (v: number) => void;
};

/**
 * Percentual de 0 a 100, digitado como se fala: "50", "33,33" (vírgula ou ponto), com o "%" fixo
 * ao lado. Diferente do `type="number"`: dá para apagar tudo e redigitar (vazio vale 0, sem o campo
 * voltar para "0" no meio da digitação) e a rolagem do mouse não muda o valor.
 */
export function PercentInput({ value, onChange, className, placeholder, onBlur, ...rest }: Props) {
  const fmt = (v: number) => (v ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '');
  const [texto, setTexto] = useState(fmt(value));
  // valor trocado de fora (botão "o que falta"): reflete no campo
  useEffect(() => {
    if (parse(texto) !== value) setTexto(fmt(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={cn('relative', className)}>
      <input
        {...rest}
        className={cn(inputCls, 'pr-8 text-right tnum')}
        inputMode="decimal"
        placeholder={placeholder ?? '0'}
        value={texto}
        onChange={(e) => {
          // só dígitos e uma vírgula, até 2 casas e no máximo 100
          let t = e.target.value.replace('.', ',').replace(/[^\d,]/g, '');
          const [int, ...dec] = t.split(',');
          t = dec.length ? `${int},${dec.join('').slice(0, 2)}` : int;
          if (parse(t) > 100) return;
          setTexto(t);
          onChange(parse(t));
        }}
        onBlur={(e) => { setTexto(fmt(value)); onBlur?.(e); }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-faint">%</span>
    </div>
  );
}

const parse = (t: string) => Number(t.replace(',', '.')) || 0;
