'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ChevronDown, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, impersonation, setAccessToken } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useImpersonate, useTenants } from '@/lib/hooks';

/**
 * "Ver cliente" do dono (docs/donos-do-sistema.md#ver-cliente): entra em qualquer cliente pelo
 * menu, sem ir até Clientes, e a seção de dono continua no menu. "Minha conta" volta à sessão
 * própria — a empresa do dono, se ele tiver uma, ou o Financeiro.
 */
export function OwnerSwitcher({ collapsed }: { collapsed: boolean }) {
  const tenants = useTenants();
  const impersonate = useImpersonate();
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const atual = typeof window !== 'undefined' ? impersonation.get() : null;

  if (collapsed) {
    return (
      <Link href="/clientes" title={atual ? `Vendo ${atual.name} — trocar de cliente` : 'Ver cliente'} className={cn('mx-auto mb-1 p-1.5 rounded-md hover:bg-white/5', atual ? 'text-white' : 'text-side-ink/60 hover:text-white')}>
        <Eye size={17} />
      </Link>
    );
  }

  async function trocar(tenantId: string) {
    if (tenantId === (atual?.tenantId ?? '')) return;
    setBusy(true);
    try {
      if (!tenantId) {
        impersonation.set(null);
        setAccessToken(null);
        // refresh devolve o token próprio (o flag de "entrando como" já foi limpo)
        const r = await api<{ accessToken: string }>('/auth/refresh', { method: 'POST' }, false);
        setAccessToken(r.accessToken);
        qc.clear();
        // dono com empresa volta às conversas dela; sem empresa, ao Financeiro
        const eu = await api<{ tenantId: string | null }>('/auth/me');
        router.replace(eu.tenantId ? '/conversas' : '/admin');
        return;
      }
      const t = tenants.data?.find((x) => x.id === tenantId);
      const r = await impersonate.mutateAsync(tenantId);
      impersonation.set({ tenantId, name: t?.name ?? r.tenant.name });
      setAccessToken(r.accessToken);
      qc.clear();
      router.push('/conversas');
    } catch (err) { toast.err(err); } finally { setBusy(false); }
  }

  return (
    <div className="mx-2 mb-1 relative">
      <Eye size={14} className={cn('absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none', atual ? 'text-white' : 'text-side-ink/60')} />
      <select
        value={atual?.tenantId ?? ''}
        disabled={busy}
        onChange={(e) => void trocar(e.target.value)}
        title="Ver qualquer cliente como dono do sistema"
        aria-label="Ver cliente"
        className={cn('w-full appearance-none rounded-md pl-8 pr-6 py-1.5 text-[12.5px] font-medium truncate focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-60', atual ? 'bg-c4 text-white' : 'bg-white/5 text-side-ink hover:text-white')}
      >
        <option value="">{atual ? '← Voltar à minha conta' : 'Ver cliente…'}</option>
        {(tenants.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-side-ink/60" />
    </div>
  );
}
