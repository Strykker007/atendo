'use client';
import { MarcaHorizontal } from '@/components/ui/Marca';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setAccessToken, SESSION_EXPIRED_MESSAGE } from '@/lib/api';
import { Button } from '@/components/ui/Button';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // a sessão caiu no meio do uso (ver sessionExpired em lib/api.ts): explica e volta para lá
  useEffect(() => { if (new URLSearchParams(location.search).get('expirou')) setAviso(SESSION_EXPIRED_MESSAGE); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false);
      setAccessToken(r.accessToken);
      // só caminho interno: `next` vem da URL e não pode virar redirecionamento para fora
      const next = new URLSearchParams(location.search).get('next');
      router.replace(next && /^\/(?![\/\\])/.test(next) ? next : '/conversas');
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
          <MarcaHorizontal className="h-10 w-auto max-w-full object-contain object-left" />
          <p className="text-sm text-muted">Entre para acessar o atendimento</p>
        </div>
        {aviso && !error && <p role="status" className="text-sm rounded-lg border border-warn bg-warn-soft text-warn-ink px-3 py-2">{aviso}</p>}
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
