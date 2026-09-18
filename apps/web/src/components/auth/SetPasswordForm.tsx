'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, inputCls } from '@/components/ui/Modal';

/** Senha + confirmação, com regras claras. Usado em redefinir, convite e trocar senha. */
export function SetPasswordForm({ onSubmit, pending, label = 'Nova senha', submitLabel = 'Salvar senha', extra }: { onSubmit: (password: string) => void; pending: boolean; label?: string; submitLabel?: string; extra?: React.ReactNode }) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const weak = p1.length > 0 && p1.length < 8;
  const mismatch = p2.length > 0 && p1 !== p2;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!weak && !mismatch) onSubmit(p1); }} className="space-y-4">
      {extra}
      <Field label={label} hint="Mínimo 8 caracteres."><input type="password" className={inputCls} value={p1} onChange={(e) => setP1(e.target.value)} minLength={8} required autoComplete="new-password" /></Field>
      <Field label="Confirmar senha"><input type="password" className={inputCls} value={p2} onChange={(e) => setP2(e.target.value)} required autoComplete="new-password" /></Field>
      {mismatch && <p className="text-xs text-danger">As senhas não conferem.</p>}
      <Button type="submit" className="w-full" loading={pending} loadingText="Salvando…" disabled={weak || mismatch || !p1}>{submitLabel}</Button>
    </form>
  );
}
