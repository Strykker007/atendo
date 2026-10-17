'use client';
import { MarcaHorizontal } from '@/components/ui/Marca';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ACCESS_BLOCK_MESSAGES, api, ApiError, setAccessToken, SESSION_EXPIRED_MESSAGE } from '@/lib/api';
import { AccessRequestModal } from '@/components/auth/AccessRequestModal';
import { Button } from '@/components/ui/Button';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // barrado pela escala: popup para pedir autorização (docs/escalas.md#pedido-de-autorização)
  const [bloqueio, setBloqueio] = useState<{ token: string; userName?: string } | null>(null);
  // a sessão caiu no meio do uso (ver sessionExpired em lib/api.ts): explica e volta para lá
  // ou a renovação foi recusada por escala/validade (docs/escalas.md): diz o motivo
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const bloqueio = q.get('bloqueio');
    if (bloqueio) setAviso(ACCESS_BLOCK_MESSAGES[bloqueio] ?? SESSION_EXPIRED_MESSAGE);
    else if (q.get('expirou')) setAviso(SESSION_EXPIRED_MESSAGE);
  }, []);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false);
      setAccessToken(r.accessToken);
      // só caminho interno: `next` vem da URL e não pode virar redirecionamento para fora
      const next = new URLSearchParams(location.search).get('next');
      router.replace(next && /^\/(?![\/\\])/.test(next) ? next : '/conversas');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'FOR_OUT_OF_SCHEDULE' && typeof err.data?.requestToken === 'string') {
        setBloqueio({ token: err.data.requestToken, userName: typeof err.data.userName === 'string' ? err.data.userName : undefined });
        return;
      }
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
      {bloqueio && <AccessRequestModal token={bloqueio.token} userName={bloqueio.userName} onClose={() => setBloqueio(null)} onRetry={() => { setBloqueio(null); void submit(); }} />}
    </main>
  );
}
