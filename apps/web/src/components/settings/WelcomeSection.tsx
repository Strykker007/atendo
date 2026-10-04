'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, Hand, Plus, Trash2 } from 'lucide-react';
import type { WelcomeMessage, WelcomeMode } from '@atendo/shared';
import { Button } from '@/components/ui/Button';
import { inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useFlows, useTenantSettings, useUpdateTenantSettings } from '@/lib/hooks';
import { AutoContentEditor } from './AutoContent';

const shortId = () => crypto.randomUUID().slice(0, 8);

/**
 * Mensagens de boas-vindas (docs/horarios.md → Boas-vindas): enviadas quando começa um
 * atendimento (contato novo ou voltando depois de encerrado), antes do fluxo de entrada.
 */
export function WelcomeSection() {
  const settings = useTenantSettings();
  const update = useUpdateTenantSettings();
  const flows = useFlows();
  const [list, setList] = useState<WelcomeMessage[]>([]);
  const [mode, setMode] = useState<WelcomeMode>('random');
  const [dirty, setDirty] = useState(false);
  // recarrega do servidor só sem rascunho: ligar/desligar salva na hora e não pode apagar o que está sendo digitado
  useEffect(() => {
    if (!settings.data || dirty) return;
    setList(settings.data.welcomeMessages ?? []);
    setMode(settings.data.welcomeMode ?? 'random');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);
  if (!settings.data) return null;

  const s = settings.data;
  const set = (next: WelcomeMessage[]) => { setList(next); setDirty(true); };
  // fluxo de boas-vindas ativo + mensagens ligadas = contato novo recebe dois cumprimentos
  const welcomeFlow = s.welcomeFlowId ? flows.data?.find((f) => f.id === s.welcomeFlowId && f.isActive) : undefined;
  const duplicated = s.welcomeEnabled && !!welcomeFlow && (s.welcomeMessages ?? []).length > 0;
  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h3 className="font-display font-semibold text-ink flex items-center gap-2"><Hand size={16} /> Boas-vindas</h3>
        <p className="text-sm text-muted mt-0.5">
          Enviada quando começa um atendimento (contato novo ou voltando depois de encerrado), antes do fluxo de entrada. Numa faixa de horário com <b>“enviar e parar”</b> (ex.: Fechado) não sai — vai só a mensagem da faixa.
        </p>
      </div>
      <label className="flex items-center gap-2 text-[13px] text-ink">
        <input
          type="checkbox"
          checked={s.welcomeEnabled}
          disabled={update.isPending}
          onChange={(e) => update.mutateAsync({ welcomeEnabled: e.target.checked }).then(() => toast.ok(e.target.checked ? 'Boas-vindas ligadas' : 'Boas-vindas desligadas')).catch(toast.err)}
        />
        Enviar mensagens de boas-vindas
      </label>
      {duplicated && (
        <p className="flex items-start gap-1.5 text-[12px] text-warn-ink bg-warn-soft rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>O <b>Fluxo de boas-vindas</b> (“{welcomeFlow?.name}”) também está ativo em Fluxos padrão: o contato novo recebe as mensagens daqui <b>e</b> o fluxo. Desligue um dos dois se o fluxo já cumprimenta.</span>
        </p>
      )}
      {!s.welcomeEnabled && list.length > 0 && <p className="text-[12px] text-faint">Desligadas: as mensagens ficam guardadas, mas ninguém recebe.</p>}
      {list.map((w, i) => (
        <div key={w.id} className="rounded-lg border border-line p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-ink">Boas-vindas {i + 1}</span>
            <button className="text-faint hover:text-danger p-1" title="Remover" onClick={() => set(list.filter((x) => x.id !== w.id))}><Trash2 size={13} /></button>
          </div>
          <AutoContentEditor items={w.items} onChange={(items) => set(list.map((x) => (x.id === w.id ? { ...x, items } : x)))} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => set([...list, { id: shortId(), items: [{ id: shortId(), kind: 'text', text: 'Olá {{contact.name}}! 👋' }] }])}>Nova boas-vindas</Button>
        {list.length > 1 && (
          <label className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            Alternância
            <select className={`${inputCls} w-auto py-1`} value={mode} onChange={(e) => { setMode(e.target.value as WelcomeMode); setDirty(true); }}>
              <option value="random">Aleatória</option>
              <option value="sequential">Sequencial (uma de cada vez, em ordem)</option>
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button disabled={!dirty} loading={update.isPending} onClick={() => update.mutateAsync({ welcomeMessages: list, welcomeMode: mode }).then(() => { setDirty(false); toast.ok('Boas-vindas salvas'); }).catch(toast.err)}>Salvar boas-vindas</Button>
        {dirty && <span className="text-[12px] text-warn-ink">alterações não salvas</span>}
        {!list.length && <span className="text-[12px] text-faint">Nenhuma: ninguém recebe boas-vindas automática (o fluxo de boas-vindas, se houver, continua).</span>}
      </div>
    </section>
  );
}
