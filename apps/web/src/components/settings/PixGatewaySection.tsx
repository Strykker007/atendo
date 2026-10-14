'use client';
import { useState } from 'react';
import { Zap, CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useConnectPaymentGateway, useDisconnectPaymentGateway, usePaymentGateway } from '@/lib/hooks';

/**
 * Pix automático no orçamento (docs/orcamentos.md#pix-automático). A empresa cola a chave de
 * API do Asaas; o sistema valida e cadastra o webhook na conta dela. O dinheiro cai direto lá,
 * e o orçamento vira "Pago" sozinho — sem comprovante, sem conferir extrato.
 */
export function PixGatewaySection() {
  const g = usePaymentGateway();
  const connect = useConnectPaymentGateway();
  const disconnect = useDisconnectPaymentGateway();
  const [apiKey, setApiKey] = useState('');
  const [sandbox, setSandbox] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const s = g.data;

  async function conectar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await connect.mutateAsync({ apiKey: apiKey.trim(), sandbox });
      setApiKey('');
      setTrocando(false);
      toast.ok('Conta do Asaas conectada — webhook cadastrado');
    } catch (err) { toast.err(err); }
  }

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink flex items-center gap-2"><Zap size={16} className="text-ok" /> Pix automático (Asaas)</h2>
        <p className="text-xs text-muted mt-0.5">O orçamento sai com Pix no valor exato; quando o cliente paga, o Asaas avisa e o orçamento fica “Pago” sozinho. O dinheiro cai direto na sua conta do Asaas.</p>
      </div>

      {s && !s.feature && <p className="rounded-xl bg-field px-4 py-3 text-sm text-muted">Não incluído no seu plano. Fale com o suporte para liberar.</p>}

      {s?.feature && s.connected && !trocando && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3">
          <CircleCheck size={18} className="text-ok shrink-0" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium text-ink">Conectado{s.accountName ? ` — ${s.accountName}` : ''}</div>
            <div className="text-xs text-muted">{s.sandbox ? 'Sandbox (testes, sem dinheiro de verdade)' : 'Produção'} · desde {new Date(s.connectedAt!).toLocaleDateString('pt-BR')}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setTrocando(true)}>Trocar chave</Button>
          <Button variant="subtle" size="sm" onClick={() => setSaindo(true)}>Desconectar</Button>
        </div>
      )}

      {s?.feature && (!s.connected || trocando) && (
        <form onSubmit={conectar} className="space-y-2">
          <ol className="text-xs text-muted list-decimal pl-4 space-y-0.5">
            <li>No Asaas: <b className="text-ink">Integrações → Chaves de API → Gerar chave</b>.</li>
            <li>Cole a chave aqui e conecte. O webhook é cadastrado sozinho — não precisa configurar nada no Asaas.</li>
          </ol>
          <input className={inputCls} type="password" autoComplete="off" placeholder="$aact_…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
            <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} /> Conta de testes (sandbox)
          </label>
          <div className="flex justify-end gap-2">
            {trocando && <Button type="button" variant="ghost" onClick={() => setTrocando(false)}>Cancelar</Button>}
            <Button type="submit" disabled={apiKey.trim().length < 20} loading={connect.isPending} loadingText="Validando…">Conectar</Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={saindo}
        title="Desconectar o Asaas?"
        text="Orçamentos novos voltam a usar chave Pix manual. Cobranças já geradas continuam no Asaas, mas não dão mais baixa sozinhas aqui."
        confirmLabel="Desconectar"
        danger
        onClose={() => setSaindo(false)}
        onConfirm={() => disconnect.mutateAsync().then(() => toast.ok('Asaas desconectado'), toast.err)}
      />
    </section>
  );
}
