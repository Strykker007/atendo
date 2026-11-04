'use client';
import { useEffect, useState } from 'react';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { useMe } from '@/lib/hooks';
import { AdminPartners } from '@/components/partners/AdminPartners';
import { AdminPayouts } from '@/components/partners/AdminPayouts';
import { AdminAudit, AdminSecurity, AdminSettings } from '@/components/partners/AdminSettings';
import { tabCls } from '@/components/partners/shared';

type Aba = 'parceiros' | 'pagamentos' | 'config' | 'seguranca' | 'auditoria';
const ABAS: [Aba, string][] = [['parceiros', 'Parceiros'], ['pagamentos', 'Pagamentos'], ['config', 'Configuração'], ['seguranca', 'Segurança'], ['auditoria', 'Auditoria']];

/** VogoPartners — tela do dono do sistema (docs/37-vogopartners.md). */
export default function ParceirosPage() {
  const me = useMe();
  const [aba, setAba] = useState<Aba>('parceiros');
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get('aba');
    if (ABAS.some(([k]) => k === a)) setAba(a as Aba);
  }, []);
  if (me.data && !me.data.systemOwner) return <PageShell><p className="text-sm text-muted">Área restrita ao dono do sistema.</p></PageShell>;

  return (
    <PageShell width="max-w-6xl">
      <PageHeader title="VogoPartners" subtitle="Parceiros que cadastram e cuidam de clientes: comissão sobre a mensalidade (por mês) e a instalação (por semana)." action={
        <div className="flex items-center gap-1 rounded-lg bg-field p-1 h-10 text-sm overflow-x-auto max-w-full">
          {ABAS.map(([k, l]) => <button key={k} onClick={() => setAba(k)} className={tabCls(aba === k)}>{l}</button>)}
        </div>
      } />
      {aba === 'parceiros' && <AdminPartners />}
      {aba === 'pagamentos' && <AdminPayouts />}
      {aba === 'config' && <AdminSettings />}
      {aba === 'seguranca' && <AdminSecurity />}
      {aba === 'auditoria' && <AdminAudit />}
    </PageShell>
  );
}
