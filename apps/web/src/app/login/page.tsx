'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setAccessToken } from '@/lib/api';

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
    <main className="min-h-screen grid place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-surface-border p-8 space-y-5">
        <div>
          <div className="text-2xl font-semibold text-brand">Atendo</div>
          <p className="text-sm text-gray-500">Entre para acessar o atendimento</p>
        </div>
        <label className="block text-sm">
          <span className="text-gray-700">E-mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1 w-full rounded-lg border border-surface-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/40" />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Senha</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="mt-1 w-full rounded-lg border border-surface-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/40" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={loading} className="w-full rounded-lg bg-brand hover:bg-brand-hover text-white py-2 font-medium disabled:opacity-60">
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
