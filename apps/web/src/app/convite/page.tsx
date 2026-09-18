'use client';
import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { AuthShell, AuthLink } from '@/components/auth/AuthShell';
import { SetPasswordForm } from '@/components/auth/SetPasswordForm';
import { toast } from '@/components/ui/Toast';

export default function ConvitePage() { return <Suspense><Inner /></Suspense>; }
function Inner() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function submit(password: string) {
    setPending(true);
    try {
      const r = await api<{ email: string }>('/auth/accept-invite', { method: 'POST', body: JSON.stringify({ token, password }) }, false);
      toast.ok(`Pronto! Entre com ${r.email} e a senha que você criou.`);
      router.replace('/login');
    } catch (err) { toast.err(err); } finally { setPending(false); }
  }
  if (!token) return <AuthShell title="Convite inválido"><p className="text-sm text-muted">Este link está incompleto. Peça ao seu administrador para reenviar o convite.</p></AuthShell>;
  return (
    <AuthShell title="Bem-vindo à equipe" subtitle="Crie a sua senha para começar a atender." footer={<AuthLink href="/login">Já tenho senha</AuthLink>}>
      <SetPasswordForm onSubmit={submit} pending={pending} label="Sua senha" submitLabel="Criar senha e entrar" />
    </AuthShell>
  );
}
