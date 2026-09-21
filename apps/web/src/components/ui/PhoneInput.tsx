'use client';
import { inputCls } from './Modal';
import { cn } from '@/lib/utils';

/**
 * Telefone com máscara. O valor guardado é só dígitos com DDI (ex.: 5562999998888);
 * o usuário vê "+55 (62) 99999-8888". Aceita colar em qualquer formato.
 */
export function formatPhone(digits: string) {
  const d = digits.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55')) {
    const rest = d.slice(2);
    const ddd = rest.slice(0, 2), num = rest.slice(2, 11);
    const local = num.length > 5 ? `${num.slice(0, num.length - 4)}-${num.slice(-4)}` : num;
    return `+55${ddd ? ` (${ddd}` : ''}${ddd.length === 2 ? ')' : ''}${local ? ` ${local}` : ''}`;
  }
  return `+${d}`;
}

export function PhoneInput({ value, onChange, className, placeholder = '+55 (62) 99999-8888', required }: { value: string; onChange: (digits: string) => void; className?: string; placeholder?: string; required?: boolean }) {
  return (
    <input
      type="tel"
      inputMode="tel"
      className={cn(inputCls, 'tnum', className)}
      value={formatPhone(value)}
      placeholder={placeholder}
      required={required}
      onChange={(e) => {
        let d = e.target.value.replace(/\D/g, '');
        // sem DDI: assume Brasil quando parece número nacional (10–11 dígitos)
        if (d.length >= 10 && d.length <= 11 && !d.startsWith('55')) d = '55' + d;
        onChange(d.slice(0, 15));
      }}
      onBlur={(e) => { const d = e.target.value.replace(/\D/g, ''); if (d && d.length < 12) onChange(d.startsWith('55') ? d : '55' + d); }}
    />
  );
}
