'use client';
import { useState } from 'react';
import { Plus, X, XCircle } from 'lucide-react';
import { inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useTenantSettings, useUpdateTenantSettings } from '@/lib/hooks';

/** limite da API (`SettingsDto.lossReasons`) */
const MAX = 30;

/**
 * Motivos sugeridos no encerramento "Não comprou". O relatório "Motivos de perda" agrupa
 * pelo texto, então lista curta e fixa rende mais que cada atendente escrevendo do seu jeito.
 * Remover um motivo não mexe no histórico: os encerramentos antigos continuam com o texto deles.
 */
export function LossReasonsSection() {
  const settings = useTenantSettings();
  const update = useUpdateTenantSettings();
  const [novo, setNovo] = useState('');
  if (!settings.data) return null;
  const motivos = settings.data.lossReasons ?? [];

  const salvar = (lista: string[], ok: string) => update.mutateAsync({ lossReasons: lista }).then(() => toast.ok(ok)).catch(toast.err);

  function adicionar(e: React.FormEvent) {
    e.preventDefault();
    const m = novo.trim();
    if (!m) return;
    if (motivos.some((x) => x.toLowerCase() === m.toLowerCase())) return toast.err(new Error('Esse motivo já existe'));
    salvar([...motivos, m], 'Motivo adicionado').then(() => setNovo(''));
  }

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h3 className="font-display font-semibold text-ink flex items-center gap-2"><XCircle size={16} /> Motivos de perda</h3>
        <p className="text-sm text-muted mt-0.5">Aparecem para um clique ao encerrar como &quot;Não comprou&quot; e formam o gráfico de Motivos de perda em Relatórios. O atendente ainda pode escrever outro.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!motivos.length && <span className="text-[13px] text-faint">Nenhum motivo cadastrado.</span>}
        {motivos.map((m) => (
          <span key={m} className="inline-flex items-center gap-1 rounded-full border border-line bg-field pl-2.5 pr-1 py-0.5 text-[13px] text-ink">
            {m}
            <button type="button" aria-label={`Remover ${m}`} disabled={update.isPending} onClick={() => salvar(motivos.filter((x) => x !== m), 'Motivo removido')} className="p-0.5 rounded-full text-muted hover:text-danger hover:bg-panel disabled:opacity-50">
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <form onSubmit={adicionar} className="flex gap-2">
        <input className={`${inputCls} flex-1 min-w-0`} placeholder="Novo motivo (ex.: Sem estoque)" value={novo} onChange={(e) => setNovo(e.target.value)} maxLength={200} disabled={motivos.length >= MAX} />
        <Button type="submit" variant="ghost" icon={<Plus size={14} />} loading={update.isPending} disabled={!novo.trim() || motivos.length >= MAX}>Adicionar</Button>
      </form>
    </section>
  );
}
