'use client';
import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { useAgents, type NumberItem } from '@/lib/hooks';

/**
 * Resumo de "quem recebe automaticamente" deste número (docs/distribuicao-por-numero.md). Só leitura:
 * toda delegação de acesso fica num lugar só, a tela de Acesso de cada pessoa em Equipe
 * (docs/18-perfis-de-acesso.md#tela-de-acesso).
 */
export function NumberReceivers({ number }: { number: NumberItem }) {
  const agents = useAgents();
  const ids = number.receiverIds ?? [];
  const nomes = (agents.data ?? []).filter((a) => ids.includes(a.id)).map((a) => a.name.split(' ')[0]);
  return (
    <div className="flex items-start gap-2 rounded-lg bg-field px-3 py-2 text-[12.5px]">
      <Inbox size={13} className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <span className="font-semibold text-ink">Recebe automaticamente: </span>
        <span className="text-muted">{ids.length ? nomes.join(', ') : 'todos que veem este número'}</span>
      </div>
      <Link href="/equipe" className="shrink-0 font-semibold text-accent-ink hover:underline" title="Definido no Acesso de cada pessoa">Equipe → Acesso</Link>
    </div>
  );
}
