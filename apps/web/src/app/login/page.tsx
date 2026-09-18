'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setAccessToken } from '@/lib/api';
import { Button } from '@/components/ui/Button';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('demo@atendo.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false);
      setAccessToken(r.accessToken);
      router.replace('/conversas');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-4 bg-canvas">
      <form onSubmit={submit} className="w-full max-w-sm bg-panel rounded-2xl shadow-sm border border-line p-8 space-y-5">
        <div>
          <div className="flex items-center gap-2.5"><span className="w-9 h-9 rounded-xl bg-accent grid place-items-center text-white font-display font-bold">A</span><span className="font-display text-2xl font-semibold text-ink tracking-tight">Atendo</span></div>
          <p className="text-sm text-muted">Entre para acessar o atendimento</p>
        </div>
        <label className="block text-sm">
          <span className="text-ink">E-mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1 w-full rounded-lg border border-line px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/40" />
        </label>
        <label className="block text-sm">
          <span className="text-ink">Senha</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="mt-1 w-full rounded-lg border border-line px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/40" />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="text-right -mt-2"><a href="/esqueci-senha" className="text-xs text-accent-ink hover:underline">Esqueci minha senha</a></div>
        <Button type="submit" className="w-full" loading={loading} loadingText="Entrando…">Entrar</Button>
      </form>
    </main>
  );
}
