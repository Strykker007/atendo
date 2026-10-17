'use client';
import { useEffect, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { toast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { inputCls } from '@/components/ui/Modal';
import { useTenantSettings, useUpdateTenantSettings } from '@/lib/hooks';
import { Regra } from './ClosingSection';

/**
 * Mensagem automática ao cliente quando o atendimento muda de mãos (para outra pessoa ou outro
 * departamento). Sai como mensagem do sistema, pela fila de envio — fora da janela de 24h da
 * API oficial, com o número desconectado ou com o contato descadastrado, não sai (e a
 * transferência acontece igual).
 */
export function TransferSection() {
  const settings = useTenantSettings();
  const update = useUpdateTenantSettings();
  const [agent, setAgent] = useState('');
  const [dept, setDept] = useState('');
  const s = settings.data;
  useEffect(() => {
    if (!s) return;
    setAgent(s.transferMessageText ?? s.transferDefaults?.agent ?? '');
    setDept(s.departmentTransferMessageText ?? s.transferDefaults?.department ?? '');
  }, [s]);
  if (!s) return null;
  const on = s.transferMessageEnabled;
  const mudou = agent !== (s.transferMessageText ?? s.transferDefaults?.agent ?? '') || dept !== (s.departmentTransferMessageText ?? s.transferDefaults?.department ?? '');
  const salvar = () => update.mutateAsync({
    // igual ao padrão (ou vazio) grava null: se o padrão melhorar, o cliente acompanha
    transferMessageText: !agent.trim() || agent.trim() === s.transferDefaults?.agent ? null : agent.trim(),
    departmentTransferMessageText: !dept.trim() || dept.trim() === s.transferDefaults?.department ? null : dept.trim(),
  }).then(() => toast.ok('Mensagens de transferência salvas')).catch(toast.err);
  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink flex items-center gap-1.5"><ArrowRightLeft size={16} className="text-accent" /> Transferência de atendimento</h2>
        <p className="text-sm text-muted">Avisa o cliente no chat quando a conversa passa para outra pessoa ou outro setor. Quem recebe a transferência sempre ganha um alerta com som na tela.</p>
      </div>
      <Regra on={on} disabled={update.isPending}
        onToggle={() => update.mutateAsync({ transferMessageEnabled: !on }).then(() => toast.ok(!on ? 'O cliente será avisado nas transferências' : 'Transferências sem aviso ao cliente')).catch(toast.err)}
        titulo="Avisar o cliente ao transferir"
        desc={on ? 'Ligado: a mensagem abaixo vai para o cliente a cada transferência.' : 'Desligado: a transferência acontece sem mensagem ao cliente.'} />
      {on && (
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted">Para outra pessoa — use <code className="font-mono">{'{{atendente}}'}</code> (primeiro nome de quem recebe)</span>
            <textarea className={inputCls} rows={2} maxLength={500} value={agent} onChange={(e) => setAgent(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted">Para outro departamento — use <code className="font-mono">{'{{departamento}}'}</code></span>
            <textarea className={inputCls} rows={2} maxLength={500} value={dept} onChange={(e) => setDept(e.target.value)} />
          </label>
          <p className="text-[11px] text-faint">Deixe em branco para voltar ao texto padrão.</p>
          <Button size="sm" onClick={salvar} disabled={!mudou} loading={update.isPending}>Salvar mensagens</Button>
        </div>
      )}
    </section>
  );
}
