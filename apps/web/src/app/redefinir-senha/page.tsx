'use client';
import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { AuthShell, AuthLink } from '@/components/auth/AuthShell';
import { SetPasswordForm } from '@/components/auth/SetPasswordForm';
import { toast } from '@/components/ui/Toast';

export default function RedefinirPage() { return <Suspense><Inner /></Suspense>; }
function Inner() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function submit(password: string) {
    setPending(true);
    try { await api('/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) }, false); toast.ok('Senha redefinida. Entre com a nova senha.'); router.replace('/login'); } catch (err) { toast.err(err); } finally { setPending(false); }
  }
  if (!token) return <AuthShell title="Link inválido" footer={<AuthLink href="/esqueci-senha">Pedir um novo link</AuthLink>}><p className="text-sm text-muted">Este link está incompleto.</p></AuthShell>;
  return <AuthShell title="Criar nova senha" footer={<AuthLink href="/login">Voltar ao login</AuthLink>}><SetPasswordForm onSubmit={submit} pending={pending} /></AuthShell>;
}
