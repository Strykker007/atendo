'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BellOff, Plus, Search, Trash2, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { inputCls } from '@/components/ui/Modal';
import { useAddIgnoredContact, useCan, useIgnoredContacts, useRemoveIgnoredContact, useStartCandidates } from '@/lib/hooks';

/** "5511999998888" → "+55 11 99999-8888". Fora do padrão BR devolve só com o "+". */
function formatPhone(d: string) {
  const br = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : `+${d}`;
}

/**
 * Contatos isentos de ticket (docs/contatos-isentos.md). Telefones da lista nunca abrem
 * atendimento: a mensagem fica em "Conversas livres" (filtros da lista), sem fila, sem robô e fora dos
 * relatórios de desempenho (TMA, TMR, volume, ranking).
 */
export default function ContatosIsentosPage() {
  const podeGerir = useCan('settings.manage');
  const lista = useIgnoredContacts();
  const add = useAddIgnoredContact();
  const remove = useRemoveIgnoredContact();
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  // busca de contato existente, com debounce
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  useEffect(() => { const t = setTimeout(() => setTermo(busca.trim()), 300); return () => clearTimeout(t); }, [busca]);
  const candidatos = useStartCandidates(termo, podeGerir);
  const isentos = new Set((lista.data ?? []).map((r) => r.contact?.id).filter(Boolean));

  async function adicionar(body: { phone?: string; contactId?: string; label?: string }) {
    try {
      await add.mutateAsync(body);
      toast.ok('Adicionado. Este contato não abre mais ticket.');
      setPhone(''); setLabel(''); setBusca('');
    } catch (err) { toast.err(err); }
  }

  return (
    <PageShell width="max-w-3xl">
      <Link href="/configuracoes" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft size={14} /> Configurações</Link>
      <PageHeader title="Contatos isentos de ticket" subtitle="Números que nunca geram atendimento: diretoria, fornecedores, celulares da própria equipe." />

      <p className="flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[12.5px] text-accent-ink">
        <BellOff size={15} className="shrink-0 mt-0.5" />
        <span>A mensagem continua chegando e pode ser respondida, mas fica em <b>Conversas livres</b> (nos filtros da lista de conversas): não entra na fila, não aciona o robô, não tem dono e não conta em nenhum relatório de desempenho (TMA, TMR, volume, ranking).</span>
      </p>

      {podeGerir && (
        <section className="rounded-2xl border border-line bg-panel p-4 space-y-3">
          <h2 className="font-display font-semibold text-ink text-sm">Adicionar</h2>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (phone.trim()) void adicionar({ phone, label: label || undefined }); }}>
            <input className={cn(inputCls, 'flex-1 min-w-40')} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefone com DDI (5511999998888)" aria-label="Telefone" inputMode="tel" />
            <input className={cn(inputCls, 'flex-1 min-w-40')} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Apelido (opcional)" aria-label="Apelido" maxLength={80} />
            <Button type="submit" loading={add.isPending} disabled={!phone.trim()}><Plus size={14} /> Adicionar</Button>
          </form>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className={cn(inputCls, 'pl-8')} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ou busque um contato pelo nome ou telefone e clique nele" aria-label="Buscar contato" />
          </div>
          {termo.length >= 2 && (
            <ul className="divide-y divide-line rounded-lg border border-line max-h-60 overflow-y-auto">
              {(candidatos.data?.contacts ?? []).length === 0 ? (
                <li className="px-3 py-2 text-[13px] text-faint">{candidatos.isFetching ? 'Buscando…' : 'Nenhum contato encontrado.'}</li>
              ) : candidatos.data!.contacts.map((c) => {
                // a linha inteira isenta: clicar no contato achado é o gesto natural, o botão pequeno passava batido
                const ja = isentos.has(c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={ja || add.isPending}
                      onClick={() => void adicionar({ contactId: c.id })}
                      title={ja ? 'Este contato já está na lista' : 'Isentar este contato'}
                      className="group w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-field disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <UserRound size={15} className="text-faint shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm text-ink">{c.name || formatPhone(c.phone)}</p>
                        <p className="text-[12px] text-faint">{formatPhone(c.phone)}</p>
                      </div>
                      {ja
                        ? <span className="text-[12px] text-muted">Já isento</span>
                        : <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-faint group-hover:text-accent-ink"><Plus size={13} /> Isentar</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {lista.isLoading ? <SkeletonRows /> : !lista.data?.length ? (
        <Empty icon={<BellOff size={28} />} title="Nenhum contato isento" text="Toda mensagem recebida abre atendimento normalmente." />
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-panel">
          {lista.data.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="w-8 h-8 rounded-full bg-field text-muted grid place-items-center shrink-0"><BellOff size={15} /></div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-ink">{r.label || r.contact?.name || formatPhone(r.phone)}</p>
                <p className="text-[12px] text-faint">{formatPhone(r.phone)}{r.contact?.name && r.label && r.label !== r.contact.name ? ` · ${r.contact.name}` : ''}</p>
              </div>
              {podeGerir && (
                <button
                  type="button"
                  className="text-muted hover:text-danger p-1.5 rounded-md hover:bg-field"
                  title="Tirar da lista (volta a abrir ticket)"
                  aria-label="Remover"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(r.id, { onSuccess: () => toast.ok('Removido. A próxima mensagem abre ticket normalmente.'), onError: (err) => toast.err(err) })}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
