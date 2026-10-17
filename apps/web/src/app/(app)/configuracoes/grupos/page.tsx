'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Search, ShieldCheck, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { inputCls } from '@/components/ui/Modal';
import { useAuthorizeGroup, useCan, useGroups, useNumbers, useSyncGroups } from '@/lib/hooks';

/**
 * Grupos restritos (docs/grupos.md). Opt-in estrito: o admin marca, um a um, os grupos que
 * podem receber transmissão. Grupo nenhum abre atendimento — mensagens de grupo são
 * descartadas no webhook, marcado ou não.
 */
export default function GruposPage() {
  const podeGerir = useCan('numbers.manage');
  const numbers = useNumbers();
  const qr = (numbers.data ?? []).filter((n) => n.provider === 'evolution' && n.isActive);
  const [numberId, setNumberId] = useState('');
  useEffect(() => { if (!numberId && qr[0]) setNumberId(qr[0].id); }, [qr.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const number = qr.find((n) => n.id === numberId);

  const groups = useGroups(numberId || undefined, !!numberId);
  const sync = useSyncGroups();
  const authorize = useAuthorizeGroup();
  const [q, setQ] = useState('');
  const [soMarcados, setSoMarcados] = useState(false);

  const lista = useMemo(() => {
    const termo = q.trim().toLowerCase();
    return (groups.data ?? []).filter((g) => (!soMarcados || g.authorized) && (!termo || g.name.toLowerCase().includes(termo)));
  }, [groups.data, q, soMarcados]);
  const marcados = (groups.data ?? []).filter((g) => g.authorized).length;

  async function atualizar() {
    try {
      const r = await sync.mutateAsync(numberId);
      toast.ok(`${r.length} grupo(s) encontrados`);
    } catch (err) { toast.err(err); }
  }

  return (
    <PageShell width="max-w-3xl">
      <Link href="/configuracoes#empresa" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft size={14} /> Configurações</Link>
      <PageHeader
        title="Grupos autorizados"
        subtitle="Marque só os grupos que podem receber transmissões e promoções. Os demais são ignorados por completo."
        action={podeGerir && number ? <Button variant="ghost" onClick={() => void atualizar()} loading={sync.isPending} loadingText="Buscando…"><RefreshCw size={14} /> Buscar grupos do WhatsApp</Button> : undefined}
      />

      <p className="flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[12.5px] text-accent-ink">
        <ShieldCheck size={15} className="shrink-0 mt-0.5" />
        <span>Grupo não abre atendimento: o que os membros escrevem nunca chega à caixa de entrada, nem fica gravado. O envio para grupo segue as mesmas travas antiban da transmissão (20–60 s entre mensagens, horário de funcionamento e teto por 24h do número).</span>
      </p>

      {qr.length === 0 && !numbers.isLoading ? (
        <Empty icon={<UsersRound size={28} />} title="Nenhum número por QR Code" text="Grupos só existem na conexão por QR Code — a API oficial da Meta não envia para grupos." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select className={cn(inputCls, 'w-auto')} value={numberId} onChange={(e) => setNumberId(e.target.value)} aria-label="Número">
              {qr.map((n) => <option key={n.id} value={n.id}>{n.label}{n.status !== 'connected' ? ' (desconectado)' : ''}</option>)}
            </select>
            <div className="relative flex-1 min-w-48">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <input className={cn(inputCls, 'pl-8')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar grupo" aria-label="Buscar grupo" />
            </div>
            <label className="flex items-center gap-1.5 text-[13px] text-muted cursor-pointer">
              <input type="checkbox" checked={soMarcados} onChange={(e) => setSoMarcados(e.target.checked)} /> Só autorizados ({marcados})
            </label>
          </div>

          {groups.isLoading ? <SkeletonRows /> : lista.length === 0 ? (
            <Empty icon={<UsersRound size={28} />} title={groups.data?.length ? 'Nenhum grupo neste filtro' : 'Nenhum grupo listado'} text={groups.data?.length ? 'Ajuste a busca.' : 'Clique em “Buscar grupos do WhatsApp” com o número conectado.'} />
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line bg-panel">
              {lista.map((g) => (
                <li key={g.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="w-8 h-8 rounded-full bg-field text-muted grid place-items-center shrink-0"><UsersRound size={15} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{g.name}</p>
                    <p className="text-[12px] text-faint">{g.size > 0 ? `${g.size} participante(s)` : 'Participantes não informados'}</p>
                  </div>
                  <label className={cn('flex items-center gap-2 text-[13px]', podeGerir ? 'cursor-pointer' : 'opacity-60')}>
                    <input
                      type="checkbox"
                      checked={g.authorized}
                      disabled={!podeGerir || authorize.isPending}
                      onChange={(e) => authorize.mutate({ id: g.id, authorized: e.target.checked }, { onError: (err) => toast.err(err) })}
                    />
                    <span className={g.authorized ? 'text-ok font-medium' : 'text-muted'}>{g.authorized ? 'Autorizado' : 'Ignorado'}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PageShell>
  );
}
