'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Eye, LogOut } from 'lucide-react';
import { impersonation, setAccessToken, api } from '@/lib/api';
import { useMe } from '@/lib/hooks';

/** Faixa fixa quando o dono está "dentro" de um cliente. Sair volta ao Financeiro. */
export function ImpersonationBanner() {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const imp = typeof window !== 'undefined' ? impersonation.get() : null;
  if (!me.data?.impersonatorId || !imp) return null;

  async function leave() {
    impersonation.set(null);
    setAccessToken(null);
    // refresh devolve o token do dono (sem impersonação, pois o flag já foi limpo)
    try { const r = await api<{ accessToken: string }>('/auth/refresh', { method: 'POST' }, false); setAccessToken(r.accessToken); } catch { /* login pedirá de novo */ }
    qc.clear();
    router.replace('/clientes');
  }

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-[13px] bg-c4 text-white">
      <Eye size={15} />
      <span className="flex-1">Você está vendo <b>{imp.name}</b> como dono do sistema — tudo que fizer aqui vale como se fosse o admin deste cliente.</span>
      <button onClick={leave} className="inline-flex items-center gap-1 rounded-md bg-white/15 hover:bg-white/25 px-2 py-0.5 font-medium"><LogOut size={13} /> Sair do cliente</button>
    </div>
  );
}
