'use client';
import { useEffect, useState } from 'react';
import { Shuffle } from 'lucide-react';
import { reassignAfterMinutes, AUTO_REASSIGN_FULL_LOAD } from '@atendo/shared';
import { toast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { inputCls } from '@/components/ui/Modal';
import { useTenantSettings, useUpdateTenantSettings } from '@/lib/hooks';
import { Regra } from './ClosingSection';
import { cn } from '@/lib/utils';

/**
 * Redistribuição automática de conversas órfãs (docs/redistribuicao-automatica.md). A cada minuto o
 * sistema olha quem está esperando resposta há mais que o tempo do momento e passa para o atendente
 * online com menos conversas abertas. O tempo vai da base ao teto conforme a carga da equipe.
 */
export function AutoReassignSection() {
  const settings = useTenantSettings();
  const update = useUpdateTenantSettings();
  const s = settings.data;
  const [base, setBase] = useState(15);
  const [max, setMax] = useState(30);
  const [vezes, setVezes] = useState(2);
  const [fora, setFora] = useState(30);
  useEffect(() => {
    if (!s) return;
    setBase(s.autoReassignBaseMinutes);
    setMax(s.autoReassignMaxMinutes);
    setVezes(s.autoReassignMaxTimes);
    setFora(s.releaseAwayMinutes);
  }, [s]);
  if (!s) return null;

  const ligado = s.autoReassignWaiting || s.autoReassignAssigned;
  const mudou = base !== s.autoReassignBaseMinutes || max !== s.autoReassignMaxMinutes || vezes !== s.autoReassignMaxTimes;
  const valido = base >= 1 && base <= 240 && max >= 1 && max <= 480 && vezes >= 1 && vezes <= 10;
  const salvar = () =>
    update.mutateAsync({ autoReassignBaseMinutes: base, autoReassignMaxMinutes: Math.max(base, max), autoReassignMaxTimes: vezes })
      .then(() => toast.ok('Tempos da redistribuição salvos'))
      .catch(toast.err);
  const alternar = (campo: 'autoReassignWaiting' | 'autoReassignAssigned', msgOn: string, msgOff: string) =>
    update.mutateAsync(campo === 'autoReassignWaiting' ? { autoReassignWaiting: !s[campo] } : { autoReassignAssigned: !s[campo] }).then(() => toast.ok(!s[campo] ? msgOn : msgOff)).catch(toast.err);
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));
  // exemplo com 5 atendentes online, para a pessoa ver o tempo mudar com a fila
  const exemplo = [1, 2, 3, AUTO_REASSIGN_FULL_LOAD].map((porPessoa) => ({ porPessoa, min: reassignAfterMinutes(base, Math.max(base, max), porPessoa * 5, 5) }));

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink flex items-center gap-1.5"><Shuffle size={16} className="text-accent" /> Redistribuição automática</h2>
        <p className="text-sm text-muted">Conversa sem resposta por tempo demais vai para o atendente online com menos atendimentos abertos. Só entra quem está com o painel aberto e no turno, e que atende o número e o departamento da conversa.</p>
      </div>

      <Regra on={s.autoReassignWaiting} disabled={update.isPending}
        onToggle={() => alternar('autoReassignWaiting', 'Conversas sem dono serão redistribuídas', 'Conversas sem dono ficam na fila')}
        titulo="Na fila sem ninguém assumir"
        desc="Contato em Aguardando, sem dono e sem resposta: vai direto para alguém." />
      <Regra on={s.autoReassignAssigned} disabled={update.isPending}
        onToggle={() => alternar('autoReassignAssigned', 'Conversas paradas serão passadas adiante', 'Quem assumiu fica com a conversa')}
        titulo="Com atendente, mas sem resposta"
        desc="Quem assumiu não respondeu o contato no tempo: passa para outra pessoa, com nota interna na conversa." />
      <Regra on={s.releaseAwayEnabled} disabled={update.isPending}
        onToggle={() => update.mutateAsync({ releaseAwayEnabled: !s.releaseAwayEnabled }).then(() => toast.ok(!s.releaseAwayEnabled ? 'Atendimentos de quem sair voltam para a fila' : 'Atendimentos ficam com quem saiu')).catch(toast.err)}
        titulo="Devolver os atendimentos de quem saiu do plantão"
        desc="Quem clica em Sair (ou Sair agora no fim do turno) devolve os atendimentos abertos na hora. Quem fecha o painel sem sair, ou tem o turno encerrado, devolve depois do tempo abaixo. Pausa não conta como saída, e o administrador da conta fica com os dele." />
      {s.releaseAwayEnabled && (
        <div className="flex flex-wrap items-end gap-2 pl-1">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted">Devolver depois de quantos minutos fora do painel</span>
            <input className={cn(inputCls, 'w-32')} type="number" min={5} max={240} value={fora} onChange={(e) => setFora(num(e.target.value))} />
          </label>
          <Button size="sm" variant="subtle" disabled={fora === s.releaseAwayMinutes || fora < 5 || fora > 240} loading={update.isPending}
            onClick={() => update.mutateAsync({ releaseAwayMinutes: fora }).then(() => toast.ok('Tempo salvo')).catch(toast.err)}>Salvar</Button>
          {(fora < 5 || fora > 240) && <p className="w-full text-xs text-warn">Entre 5 e 240 minutos.</p>}
        </div>
      )}

      {ligado && (
        <div className="space-y-3 border-t border-line pt-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted">Tempo normal (min)</span>
              <input className={inputCls} type="number" min={1} max={240} value={base} onChange={(e) => setBase(num(e.target.value))} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted">Tempo máximo na alta demanda (min)</span>
              <input className={inputCls} type="number" min={1} max={480} value={max} onChange={(e) => setMax(num(e.target.value))} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted">Máximo de redistribuições por espera</span>
              <input className={inputCls} type="number" min={1} max={10} value={vezes} onChange={(e) => setVezes(num(e.target.value))} />
            </label>
          </div>

          <div className="rounded-xl bg-field px-4 py-3 text-xs text-muted space-y-1.5">
            <p className="font-semibold text-ink">Como o tempo se ajusta</p>
            <p>O sistema conta quantos contatos esperam resposta por atendente online. Com fila tranquila vale o tempo normal; quanto mais cheia, mais tempo cada um tem antes de perder a conversa, até o máximo. Na correria todos estão ocupados: trocar cedo só muda a conversa de fila.</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 tnum">
              {exemplo.map((e) => (
                <span key={e.porPessoa}>{e.porPessoa === AUTO_REASSIGN_FULL_LOAD ? `${e.porPessoa}+` : e.porPessoa === 1 ? 'até 1' : e.porPessoa} por pessoa → <b className="text-ink">{e.min} min</b></span>
              ))}
            </div>
            <p>Ninguém online: nada muda de mãos. Quem acaba de receber ganha o tempo inteiro, e a conversa não volta para quem já a perdeu nesta espera.</p>
          </div>

          {max < base && <p className="text-xs text-warn">O máximo não pode ser menor que o tempo normal: será salvo como {base} min.</p>}
          <Button size="sm" onClick={salvar} disabled={!mudou || !valido} loading={update.isPending}>Salvar tempos</Button>
        </div>
      )}
    </section>
  );
}
