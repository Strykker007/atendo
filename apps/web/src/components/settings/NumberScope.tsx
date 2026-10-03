'use client';
import { useState } from 'react';
import { Phone } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useNumbers, useUpdateAgent, type Agent } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/**
 * Quais números a pessoa opera. Escopo de dados, não permissão: "pode configurar números"
 * é diferente de "só atende pelo número da filial Centro".
 *
 * Nenhum marcado = todos. É o estado de quem nunca foi restringido e do cliente que tem um
 * número só — e o rótulo diz isso em voz alta, porque uma lista vazia que significasse
 * "nenhum" trancaria a pessoa para fora do atendimento.
 */
export function NumberScopeButton({ agent }: { agent: Agent }) {
  const numbers = useNumbers();
  const [open, setOpen] = useState(false);

  /**
   * Antes isto era um ícone de telefone solto na coluna de ações, e **sumia quando o cliente
   * tinha só um número**. O resultado prático era uma funcionalidade que ninguém achava: o
   * escopo existia no banco, a tela de configurar não aparecia. Agora é coluna própria, com o
   * resumo escrito — "Todos" é informação, não ausência de informação.
   */
  const ids = (agent.numbers ?? []).map((n) => n.numberId);
  const lista = numbers.data ?? [];
  const resumo = ids.length === 0 ? 'Todos' : lista.filter((n) => ids.includes(n.id)).map((n) => n.label).join(', ') || `${ids.length} número(s)`;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs max-w-44', ids.length ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}
        title={ids.length ? `Atende só ${resumo}` : 'Sem restrição: atende todos os números'}
      >
        <Phone size={12} className="shrink-0" />
        <span className="truncate">{resumo}</span>
      </button>
      <NumberScopeModal agent={agent} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function NumberScopeModal({ agent, open, onClose }: { agent: Agent; open: boolean; onClose: () => void }) {
  const numbers = useNumbers();
  const update = useUpdateAgent();
  const [selected, setSelected] = useState<string[]>([]);
  const [loadedFor, setLoadedFor] = useState('');

  if (open && loadedFor !== agent.id) {
    setLoadedFor(agent.id);
    setSelected((agent.numbers ?? []).map((n) => n.numberId));
  }

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Modal open={open} onClose={onClose} title={`Números de ${agent.name}`}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await update.mutateAsync({ id: agent.id, numberIds: selected });
            toast.ok(selected.length ? 'Números atualizados' : 'Passa a operar todos os números');
            onClose();
          } catch (err) { toast.err(err); }
        }}
        className="space-y-4"
      >
        <p className="text-sm text-muted">
          Marque os números que esta pessoa atende. <strong className="text-ink">Nenhum marcado = todos</strong>,
          que é o padrão.
        </p>

        <div className="space-y-1.5">
          {numbers.data?.map((n) => (
            <label key={n.id} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input type="checkbox" checked={selected.includes(n.id)} onChange={() => toggle(n.id)} />
              <span>{n.label} <span className="text-muted">· {n.phone}</span></span>
            </label>
          ))}
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
