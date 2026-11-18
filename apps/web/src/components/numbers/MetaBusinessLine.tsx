'use client';
import { Building2 } from 'lucide-react';
import { useMetaBusiness } from '@/lib/hooks';

const VERIFICACAO: Record<string, string> = { verified: 'verificado', not_verified: 'não verificado', pending: 'verificação em análise', pending_submission: 'verificação pendente', rejected: 'verificação recusada', expired: 'verificação expirada', failed: 'verificação recusada', revoked: 'verificação revogada' };

/**
 * Portfólio da Meta (Business Manager) dono do número oficial, lido na hora pela permissão
 * `business_management` (docs/meta-cadastro-incorporado.md#portfólio-do-cliente). Some sem dado.
 */
export function MetaBusinessLine({ numberId }: { numberId: string }) {
  const q = useMetaBusiness(numberId, true);
  const b = q.data?.business;
  if (!b?.name) return null;
  const st = b.verificationStatus;
  return (
    <div className="flex items-center gap-1.5 text-[12.5px] text-muted min-w-0" title={`Portfólio ${b.id}`}>
      <Building2 size={13} className="shrink-0" />
      <span className="truncate">Portfólio <b className="text-ink font-semibold">{b.name}</b></span>
      {st && <span className={st === 'verified' ? 'text-ok shrink-0' : 'shrink-0'}>· {VERIFICACAO[st] ?? st}</span>}
    </div>
  );
}
