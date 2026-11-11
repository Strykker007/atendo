'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Building2, Lock, Phone, Star } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useCompanies, useNumbers, useUpdateAgent, type Agent, type Company } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/**
 * Quais números a pessoa opera. Escopo de dados, não permissão: "pode configurar números"
 * é diferente de "só atende pelo número da filial Centro".
 *
 * Nenhum marcado = todos. É o estado de quem nunca foi restringido e do cliente que tem um
 * número só — e o rótulo diz isso em voz alta, porque uma lista vazia que significasse
 * "nenhum" trancaria a pessoa para fora do atendimento.
 */
/**
 * O acesso real é números da pessoa ∩ números das empresas dela (company-scope.ts na API). O
 * vínculo com empresa é feito na tela da empresa — sem isto, a Equipe mostrava "Todos" para
 * quem já estava limitado a uma filial.
 */
export function useCompanyScope(agentId: string) {
  const companies = useCompanies();
  const minhas: Company[] = (companies.data ?? []).filter((c) => c.users.some((u) => u.user.id === agentId));
  // null = nenhuma empresa marcada: a empresa não restringe nada
  const permitidos = minhas.length ? new Set(minhas.flatMap((c) => c.numbers.map((n) => n.id))) : null;
  return { minhas, permitidos };
}

/** `onOpen`: abre a tela única de Acesso em vez do modal só de números (docs/18-perfis-de-acesso.md#tela-de-acesso). */
export function NumberScopeButton({ agent, onOpen }: { agent: Agent; onOpen?: () => void }) {
  const numbers = useNumbers();
  const { minhas, permitidos } = useCompanyScope(agent.id);
  const [open, setOpen] = useState(false);

  /**
   * Antes isto era um ícone de telefone solto na coluna de ações, e **sumia quando o cliente
   * tinha só um número**. O resultado prático era uma funcionalidade que ninguém achava: o
   * escopo existia no banco, a tela de configurar não aparecia. Agora é coluna própria, com o
   * resumo escrito — "Todos" é informação, não ausência de informação.
   */
  const ids = (agent.numbers ?? []).map((n) => n.numberId);
  const lista = numbers.data ?? [];
  // número reservado: quem não tem marcação (e não é admin) opera só os não reservados
  const veReservados = agent.role === 'tenant_admin';
  const temReservado = !veReservados && lista.some((n) => n.reserved);
  const efetivos = lista.filter((n) => (ids.length ? ids.includes(n.id) : veReservados || !n.reserved) && (!permitidos || permitidos.has(n.id)));
  const restrito = ids.length > 0 || !!permitidos;
  const nums = !restrito ? (temReservado ? 'Todos, menos os reservados' : 'Todos') : efetivos.map((n) => n.label).join(', ') || 'Nenhum número';
  const padrao = lista.filter((n) => agent.defaultNumberIds?.includes(n.id) && efetivos.some((e) => e.id === n.id));
  const resumo = (minhas.length ? `${minhas.map((c) => c.name).join(', ')} · ${nums}` : nums) + (padrao.length ? ` · abre em ${padrao.map((n) => n.label).join(', ')}` : '');
  return (
    <>
      <button
        onClick={() => (onOpen ? onOpen() : setOpen(true))}
        className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs max-w-56', restrito ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}
        title={restrito ? `Atende só: ${resumo}` : `Sem restrição: ${resumo}`}
      >
        {minhas.length ? <Building2 size={12} className="shrink-0" /> : <Phone size={12} className="shrink-0" />}
        {padrao.length > 0 && <Star size={11} className="shrink-0 fill-current" />}
        <span className="truncate">{resumo}</span>
      </button>
      {!onOpen && <NumberScopeModal agent={agent} open={open} onClose={() => setOpen(false)} />}
    </>
  );
}

function NumberScopeModal({ agent, open, onClose }: { agent: Agent; open: boolean; onClose: () => void }) {
  const numbers = useNumbers();
  const { minhas, permitidos } = useCompanyScope(agent.id);
  const update = useUpdateAgent();
  const [selected, setSelected] = useState<string[]>([]);
  const [padrao, setPadrao] = useState<string[]>([]);
  const [loadedFor, setLoadedFor] = useState('');

  if (open && loadedFor !== agent.id) {
    setLoadedFor(agent.id);
    setSelected((agent.numbers ?? []).map((n) => n.numberId));
    setPadrao(agent.defaultNumberIds ?? []);
  }

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const togglePadrao = (id: string) => setPadrao((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const veReservados = agent.role === 'tenant_admin';
  /** a pessoa vai operar este número com a marcação atual? (é o que pode virar padrão) */
  const opera = (n: { id: string; reserved?: boolean }) => (selected.length ? selected.includes(n.id) : veReservados || !n.reserved) && (!permitidos || permitidos.has(n.id));
  const temReservado = (numbers.data ?? []).some((n) => n.reserved);

  return (
    <Modal open={open} onClose={onClose} title={`Números de ${agent.name}`}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            // padrão só entre os que ela opera: desmarcou o número, sai do padrão também
            const defaultNumberIds = padrao.filter((id) => { const n = numbers.data?.find((x) => x.id === id); return !!n && opera(n); });
            await update.mutateAsync({ id: agent.id, numberIds: selected, defaultNumberIds });
            toast.ok(selected.length ? 'Números atualizados' : 'Passa a operar todos os números');
            onClose();
          } catch (err) { toast.err(err); }
        }}
        className="space-y-4"
      >
        {minhas.length > 0 && (
          <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[13px] text-accent-ink">
            <div className="flex items-center gap-1.5 font-medium"><Building2 size={13} /> Empresas: {minhas.map((c) => c.name).join(', ')}</div>
            <div className="text-[12px] mt-0.5">Só enxerga os números dessas empresas. Para mudar, edite a empresa em <Link href="/configuracoes#empresa" className="underline">Configurações → Empresas e unidades</Link>.</div>
          </div>
        )}
        <p className="text-sm text-muted">
          Para restringir ainda mais, marque os números que esta pessoa atende. <strong className="text-ink">Nenhum marcado = todos{minhas.length ? ' os das empresas dela' : ''}{temReservado && !veReservados ? ', menos os reservados' : ''}</strong>,
          que é o padrão.
        </p>
        <p className="text-[12.5px] text-muted">
          <Star size={11} className="inline -mt-0.5 fill-current text-accent" /> <strong className="text-ink">Abre filtrado</strong>: a tela de conversas já entra mostrando só esses números (ex.: o concierge abre no número do concierge). Ela ainda pode trocar o filtro quando precisar. Nenhum = todos.
        </p>

        <div className="space-y-1.5">
          {numbers.data?.map((n) => {
            const fora = !!permitidos && !permitidos.has(n.id);
            const operaEste = opera(n);
            const ehPadrao = operaEste && padrao.includes(n.id);
            return (
              <div key={n.id} className="flex items-center gap-2">
                <label className={cn('flex min-w-0 flex-1 items-center gap-2 text-sm text-ink', fora ? 'opacity-50' : 'cursor-pointer')} title={fora ? 'Número de uma empresa que esta pessoa não opera' : undefined}>
                  <input type="checkbox" checked={selected.includes(n.id) && !fora} disabled={fora} onChange={() => toggle(n.id)} />
                  <span className="min-w-0 truncate">{n.label} <span className="text-muted">· {n.phone}</span>{fora && <span className="text-[11px] text-muted"> · fora das empresas dela</span>}</span>
                  {n.reserved && <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted" title="Reservado: só quem está marcado nele vê as conversas"><Lock size={10} /> reservado</span>}
                </label>
                <button
                  type="button"
                  onClick={() => togglePadrao(n.id)}
                  disabled={!operaEste}
                  title={operaEste ? (ehPadrao ? 'Tirar do filtro ao abrir' : 'Abrir as conversas já filtradas neste número') : 'Ela não opera este número'}
                  className={cn('shrink-0 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] disabled:opacity-30', ehPadrao ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}
                >
                  <Star size={11} className={cn(ehPadrao && 'fill-current')} /> Abre filtrado
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => setSelected([])} disabled={!selected.length}>Liberar todos</Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={update.isPending}>Salvar</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
