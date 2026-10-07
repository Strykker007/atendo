'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUI } from '@/lib/store';
import { useCan, useMyCompanies } from '@/lib/hooks';

/**
 * Empresa/unidade ativa (docs/empresas.md). A escolha vai em toda chamada da API
 * (`x-company-id`, ver lib/api.ts) e a API transforma em escopo de números — por isso trocar
 * aqui recarrega tudo: o que estava em cache era da outra unidade.
 *
 * "Todas as empresas" é visão de coordenação: só para quem vê os atendimentos da equipe.
 * O atendente com mais de uma unidade alterna entre elas, uma de cada vez.
 * Some quando o cliente não usa empresas.
 */
export function CompanySwitcher({ collapsed }: { collapsed: boolean }) {
  const qc = useQueryClient();
  const { companyId, setCompany, toggleSidebar } = useUI();
  const mine = useMyCompanies();
  const podeTodas = useCan('conversations.view_all');
  const lista = mine.data ?? [];

  function trocar(id: string | null) {
    if (id === companyId) return;
    setCompany(id);
    qc.invalidateQueries();
  }

  // escolha guardada que deixou de valer (empresa excluída, acesso retirado) ou atendente sem
  // empresa escolhida: cai num estado válido em vez de mostrar uma lista vazia sem explicação
  useEffect(() => {
    if (!mine.data) return;
    const valida = companyId && mine.data.some((c) => c.id === companyId);
    if (valida) return;
    const destino = mine.data.length && !podeTodas ? mine.data[0].id : null;
    if (destino !== companyId) trocar(destino);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.data, companyId, podeTodas]);

  if (!lista.length) return null;
  const atual = lista.find((c) => c.id === companyId);
  const sozinha = lista.length === 1 && !podeTodas;

  if (collapsed) {
    return (
      <button onClick={toggleSidebar} title={`Empresa: ${atual?.name ?? 'Todas as empresas'}`} className="mx-auto mb-1 w-9 h-9 rounded-md grid place-items-center text-side-ink hover:text-white hover:bg-white/5">
        <Building2 size={17} />
      </button>
    );
  }

  return (
    <div className="px-2 pb-1">
      <div className="relative">
        <Building2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-side-ink/70 pointer-events-none" />
        <select
          value={companyId ?? ''}
          onChange={(e) => trocar(e.target.value || null)}
          disabled={sozinha}
          title="Empresa / unidade"
          className={cn(
            'w-full appearance-none rounded-md bg-white/5 border border-side-line text-white pl-7 pr-6 py-1.5 text-[12.5px] font-semibold truncate',
            'focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-100',
            companyId && 'ring-1 ring-accent/60',
          )}
        >
          {podeTodas && <option value="" className="text-ink">Todas as empresas</option>}
          {lista.map((c) => <option key={c.id} value={c.id} className="text-ink">{c.name}</option>)}
        </select>
        {!sozinha && <ChevronDown size={14} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-side-ink/70 pointer-events-none" />}
      </div>
    </div>
  );
}
