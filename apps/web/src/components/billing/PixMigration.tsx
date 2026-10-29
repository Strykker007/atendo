'use client';
import { useState } from 'react';
import { QrCode, Eye, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { usePixEnroll, usePixSettings, useSetPixSettings, type PixEnrollRow } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('pt-BR');
const RESULTADO: Record<PixEnrollRow['result'], { label: string; cls: string }> = {
  would_enroll: { label: 'Vai migrar', cls: 'text-accent-ink' },
  enrolled: { label: 'Migrado', cls: 'text-ok' },
  no_document: { label: 'Falta CPF/CNPJ — o cliente vê o aviso no painel', cls: 'text-warn-ink' },
  not_live: { label: 'Assinatura suspensa/cancelada', cls: 'text-muted' },
  no_price: { label: 'Sem valor', cls: 'text-muted' },
  already: { label: 'Já tem gateway', cls: 'text-muted' },
  free: { label: 'Gratuito/personalizado', cls: 'text-muted' },
  error: { label: 'Erro', cls: 'text-danger-ink' },
};

/**
 * Migração da cobrança manual para a mensalidade por Pix no Asaas (docs/05#migração-para-o-asaas).
 * Sempre começa pela prévia: quem entra, com que valor e vencimento (o mesmo de hoje), e quem
 * fica de fora e por quê. Migrar cria a assinatura no Asaas e o lembrete por e-mail sai sozinho.
 */
export function PixMigration() {
  const enroll = usePixEnroll();
  const settings = usePixSettings();
  const setSettings = useSetPixSettings();
  const cfg = settings.data;
  const [confirmarLiberar, setConfirmarLiberar] = useState<boolean | null>(null);
  const [linhas, setLinhas] = useState<PixEnrollRow[] | null>(null);
  const [previa, setPrevia] = useState(true);
  const [confirmar, setConfirmar] = useState(false);
  /** "Migrar só este": um cliente da prévia (ex.: quem vence primeiro, para testar de verdade) */
  const [umSo, setUmSo] = useState<PixEnrollRow | null>(null);
  const aMigrar = linhas?.filter((l) => l.result === 'would_enroll') ?? [];

  const migrarUm = async (l: PixEnrollRow) => {
    try {
      const [r] = await enroll.mutateAsync({ dryRun: false, tenantId: l.tenantId });
      if (r) setLinhas((ls) => ls?.map((x) => (x.tenantId === r.tenantId ? r : x)) ?? null);
      if (r?.result === 'enrolled') toast.ok(`${l.tenant} migrado para o Pix automático`);
      else toast.err(r?.error ?? 'Não foi possível migrar este cliente');
    } catch (err) { toast.err(err); }
  };

  const rodar = async (dryRun: boolean) => {
    try {
      const r = await enroll.mutateAsync({ dryRun });
      setLinhas(r); setPrevia(dryRun);
      if (!dryRun) {
        const ok = r.filter((l) => l.result === 'enrolled').length;
        const erros = r.filter((l) => l.result === 'error').length;
        if (erros) toast.err(`${ok} migrado(s), ${erros} com erro — veja a lista`); else toast.ok(`${ok} cliente(s) migrado(s) para o Pix automático`);
      }
    } catch (err) { toast.err(err); }
  };

  return (
    <section className="rounded-2xl bg-panel border border-line p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[240px]">
          <h3 className="font-display font-semibold text-ink flex items-center gap-1.5"><QrCode size={16} className="text-accent" /> Mensalidade por Pix (Asaas)</h3>
          <p className="text-[12.5px] text-muted">
            Passa quem paga hoje por cobrança manual para a assinatura recorrente no Asaas — mesmo valor contratado e mesmo vencimento, sem ação do cliente.
            Antes de cada vencimento o cliente recebe o Pix por e-mail e vê o aviso no painel. Vencida sem pagar: carência do plano e depois suspensão do envio.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={<Eye size={14} />} loading={enroll.isPending && previa} loadingText="Conferindo…" onClick={() => rodar(true)}>Ver prévia</Button>
          <Button icon={<Play size={14} />} disabled={!previa || !aMigrar.length} onClick={() => setConfirmar(true)}>Migrar {aMigrar.length || ''} cliente(s)</Button>
        </div>
      </div>

      {cfg && (
        <div className={cn('rounded-xl border px-3 py-2.5 flex flex-wrap items-center gap-3', cfg.clientBilling ? 'border-ok/40 bg-ok/5' : 'border-line bg-field/50')}>
          <div className="flex-1 min-w-[240px] text-[12.5px]">
            <div className="font-medium text-ink text-sm">{cfg.clientBilling ? 'Liberada para os clientes' : 'Escondida dos clientes'}</div>
            {!cfg.asaasConfigured
              ? <p className="text-warn-ink">Sem chave do Asaas no servidor (ASAAS_API_KEY): nada funciona até configurar.</p>
              : cfg.clientBilling
                ? <p className="text-muted">Quem não tem CPF/CNPJ vê o aviso para informar e entra no Pix automático; o “Assinar” do plano cobra pelo Asaas{cfg.autoEnroll ? '; a migração diária automática está ligada' : ''}.</p>
                : <p className="text-muted">Nenhum aviso de pagamento automático para os clientes e o “Assinar” não usa o Asaas. Quem você já migrou continua com a mensalidade e os lembretes.</p>}
          </div>
          <Button size="sm" variant={cfg.clientBilling ? 'ghost' : 'primary'} disabled={!cfg.asaasConfigured} loading={setSettings.isPending} onClick={() => setConfirmarLiberar(!cfg.clientBilling)}>
            {cfg.clientBilling ? 'Esconder dos clientes' : 'Liberar para os clientes'}
          </Button>
        </div>
      )}

      {linhas && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="py-2 pr-4">Cliente</th><th className="py-2 pr-4">Plano</th><th className="py-2 pr-4 text-right">Valor</th><th className="py-2 pr-4">1º vencimento</th><th className="py-2">Situação</th><th className="py-2" /></tr></thead>
            <tbody className="divide-y divide-line">
              {linhas.map((l) => (
                <tr key={l.tenantId}>
                  <td className="py-2 pr-4 text-ink">{l.tenant}</td>
                  <td className="py-2 pr-4 text-muted">{l.plan}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{brl(l.value)}</td>
                  <td className="py-2 pr-4 tabular-nums">{l.dueDate ? dataBR(l.dueDate) : '—'}</td>
                  <td className={cn('py-2', RESULTADO[l.result].cls)}>{RESULTADO[l.result].label}{l.error ? `: ${l.error}` : ''}</td>
                  <td className="py-2 text-right">{l.result === 'would_enroll' && <Button size="sm" variant="ghost" onClick={() => setUmSo(l)}>Migrar só este</Button>}</td>
                </tr>
              ))}
              {!linhas.length && <tr><td colSpan={6} className="py-6 text-center text-muted">Ninguém na cobrança manual para migrar.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmarLiberar !== null}
        onClose={() => setConfirmarLiberar(null)}
        title={confirmarLiberar ? 'Liberar a cobrança por Pix' : 'Esconder a cobrança por Pix'}
        confirmLabel={confirmarLiberar ? 'Liberar' : 'Esconder'}
        text={confirmarLiberar
          ? 'Os clientes sem CPF/CNPJ passam a ver o aviso para ativar o pagamento automático (ao informar, a assinatura é criada no Asaas) e o “Assinar” do plano cobra pelo Asaas. Confirme que o webhook já está configurado no painel do Asaas.'
          : 'O aviso de pagamento automático some para os clientes e o “Assinar” deixa de usar o Asaas. Quem já foi migrado continua com a mensalidade, os lembretes e o “Pagar”.'}
        onConfirm={() => setSettings.mutateAsync(!!confirmarLiberar).then(() => toast.ok(confirmarLiberar ? 'Cobrança por Pix liberada para os clientes' : 'Cobrança por Pix escondida dos clientes')).catch(toast.err)}
      />

      <ConfirmDialog
        open={!!umSo}
        onClose={() => setUmSo(null)}
        title={`Migrar ${umSo?.tenant ?? ''}`}
        confirmLabel="Migrar"
        text={umSo ? `Cria a assinatura Pix no Asaas de ${brl(umSo.value)}/mês com 1º vencimento em ${umSo.dueDate ? dataBR(umSo.dueDate) : '—'}. Se vence em até 5 dias, o e-mail com o Pix sai agora. Os outros clientes não mudam.` : ''}
        onConfirm={() => (umSo ? migrarUm(umSo) : undefined)}
      />

      <ConfirmDialog
        open={confirmar}
        onClose={() => setConfirmar(false)}
        title="Migrar para o Pix automático"
        confirmLabel={`Migrar ${aMigrar.length}`}
        text={`Cria a assinatura no Asaas de ${aMigrar.length} cliente(s), somando ${brl(aMigrar.reduce((a, l) => a + l.value, 0))}/mês, com o vencimento que cada um já tem. Quem vence nos próximos 5 dias recebe o e-mail com o Pix agora.`}
        onConfirm={() => rodar(false)}
      />
    </section>
  );
}
