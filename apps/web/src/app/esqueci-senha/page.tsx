'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { AuthShell, AuthLink } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { Field, inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try { await api('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }, false); setSent(true); } catch (err) { toast.err(err); } finally { setLoading(false); }
  }
  return (
    <AuthShell title="Esqueci minha senha" subtitle="Enviamos um link para você criar uma senha nova." footer={<AuthLink href="/login">Voltar ao login</AuthLink>}>
      {sent ? (
        <p className="text-sm text-ink rounded-lg bg-ok-soft px-4 py-3">Se <b>{email}</b> estiver cadastrado, o link chega em instantes. Vale por 2 horas — confira também o spam.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="E-mail"><input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          <Button type="submit" className="w-full" loading={loading} loadingText="Enviando…">Enviar link</Button>
        </form>
      )}
    </AuthShell>
  );
}
