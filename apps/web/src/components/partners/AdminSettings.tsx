'use client';
import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import type { PartnerTierRule } from '@atendo/shared';
import { Button } from '@/components/ui/Button';
import { Field, inputCls } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import {
  usePartnerEvents, usePartnerSettings, useSetDefaultTiers, useTotpConfirm, useTotpDisable, useTotpSetup, useTotpStatus, useUpdatePartnerSettings, type PartnerSettings,
} from '@/lib/hooks';
import { EVENT_LABEL } from './AdminPartners';
import { CodeDialog, TiersEditor, cardCls, dataHoraBR } from './shared';

/** Aba Configuração: percentuais padrão, taxa de instalação e as travas de pagamento. */
export function AdminSettings() {
  const q = usePartnerSettings();
  const save = useUpdatePartnerSettings();
  const saveTiers = useSetDefaultTiers();
  const [f, setF] = useState<PartnerSettings | null>(null);
  const [tiers, setTiers] = useState<PartnerTierRule[]>([]);
  const [pedindo, setPedindo] = useState(false);
  useEffect(() => { if (q.data) { setF(q.data); setTiers(q.data.defaultTiers); } }, [q.data]);
  if (!f || !q.data) return <SkeletonRows />;
  const travasMudaram = f.pixKeyCooldownHours !== q.data.pixKeyCooldownHours || f.secondApprovalAbove !== q.data.secondApprovalAbove || f.dailyLimit !== q.data.dailyLimit;

  async function salvar(code?: string) {
    try {
      await save.mutateAsync({
        setupRate: f!.setupRate, setupFee: f!.setupFee, minPayout: f!.minPayout,
        ...(travasMudaram && { pixKeyCooldownHours: f!.pixKeyCooldownHours, secondApprovalAbove: f!.secondApprovalAbove, dailyLimit: f!.dailyLimit, code }),
      });
      toast.ok('Configuração salva'); setPedindo(false);
    } catch (err) { toast.err(err); }
  }

  return (
    <div className="space-y-5">
      <section className={cn(cardCls, 'p-5 space-y-4')}>
        <h3 className="font-semibold">Comissão padrão sobre a mensalidade</h3>
        <TiersEditor value={tiers} onChange={setTiers} />
        <div className="flex justify-end"><Button size="sm" loading={saveTiers.isPending} onClick={() => saveTiers.mutateAsync(tiers).then(() => toast.ok('Faixas padrão salvas')).catch(toast.err)}>Salvar faixas padrão</Button></div>
        <p className="text-[11.5px] text-faint">Vale para quem não tem faixas próprias. Muda a partir da próxima apuração; o que já foi apurado fica como está.</p>
      </section>

      <section className={cn(cardCls, 'p-5 space-y-4')}>
        <h3 className="font-semibold">Instalação e pagamento</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="% padrão da instalação"><input type="number" min={0} max={100} step={0.5} className={inputCls} value={f.setupRate} onChange={(e) => setF({ ...f, setupRate: Number(e.target.value) || 0 })} /></Field>
          <Field label="Taxa de instalação" hint="É o valor que o parceiro cobra na ativação — ele não muda."><MoneyInput className={inputCls} value={f.setupFee} onChange={(v) => setF({ ...f, setupFee: v ?? 0 })} /></Field>
          <Field label="Pagamento mínimo" hint="Abaixo disso, acumula para o próximo ciclo."><MoneyInput className={inputCls} value={f.minPayout} onChange={(v) => setF({ ...f, minPayout: v ?? 0 })} /></Field>
        </div>
        <h4 className="text-sm font-semibold pt-2">Travas de segurança</h4>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Carência após trocar chave Pix (horas)"><input type="number" min={0} max={720} className={inputCls} value={f.pixKeyCooldownHours} onChange={(e) => setF({ ...f, pixKeyCooldownHours: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></Field>
          <Field label="2º dono acima de" hint="Vazio = um dono basta."><MoneyInput nullable className={inputCls} value={f.secondApprovalAbove} onChange={(v) => setF({ ...f, secondApprovalAbove: v })} /></Field>
          <Field label="Teto por dia" hint="Vazio = sem teto."><MoneyInput nullable className={inputCls} value={f.dailyLimit} onChange={(v) => setF({ ...f, dailyLimit: v })} /></Field>
        </div>
        <div className="flex justify-end"><Button loading={save.isPending && !pedindo} onClick={() => (travasMudaram ? setPedindo(true) : void salvar())}>Salvar</Button></div>
        {travasMudaram && <p className="text-[11.5px] text-warn-ink text-right">Mudar as travas pede o código do autenticador.</p>}
      </section>
      <CodeDialog open={pedindo} title="Confirmar travas de segurança" busy={save.isPending} onClose={() => setPedindo(false)} onConfirm={(code) => salvar(code)} />
    </div>
  );
}

/** Aba Segurança: autenticador de quem autoriza pagamentos. */
export function AdminSecurity() {
  const st = useTotpStatus();
  const setup = useTotpSetup();
  const confirm = useTotpConfirm();
  const disable = useTotpDisable();
  const [senha, setSenha] = useState('');
  const [segredo, setSegredo] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [desativando, setDesativando] = useState(false);
  const [code, setCode] = useState('');
  if (!st.data) return <SkeletonRows />;

  return (
    <div className="space-y-5">
      <section className={cn(cardCls, 'p-5 space-y-3')}>
        <h3 className="font-semibold flex items-center gap-2">{st.data.enabled ? <ShieldCheck size={16} className="text-ok" /> : <ShieldOff size={16} className="text-warn-ink" />} Autenticador de pagamentos</h3>
        <p className="text-sm text-muted">Autorizar pagamento, trocar chave Pix de parceiro e afrouxar as travas pedem um código do seu celular. Quem descobrir sua senha não consegue tirar dinheiro sem ele.</p>
        {st.data.enabled ? (
          <>
            <p className="text-sm">Ativo desde {dataHoraBR(st.data.since)}.</p>
            {!desativando ? <Button variant="ghost" size="sm" onClick={() => setDesativando(true)}>Desativar (trocar de celular)</Button> : (
              <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); disable.mutateAsync({ password: senha, code }).then(() => { toast.ok('Autenticador desativado'); setDesativando(false); setSenha(''); setCode(''); }).catch(toast.err); }}>
                <input type="password" required placeholder="Sua senha" className={cn(inputCls, 'w-48')} value={senha} onChange={(e) => setSenha(e.target.value)} />
                <input required inputMode="numeric" placeholder="Código" maxLength={6} className={cn(inputCls, 'w-28 font-mono')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                <Button type="submit" variant="danger" size="sm" loading={disable.isPending}>Desativar</Button>
              </form>
            )}
          </>
        ) : !segredo ? (
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setup.mutateAsync(senha).then((r) => { setSegredo(r); setSenha(''); }).catch(toast.err); }}>
            <input type="password" required placeholder="Confirme sua senha" className={cn(inputCls, 'w-56')} value={senha} onChange={(e) => setSenha(e.target.value)} />
            <Button type="submit" icon={<Smartphone size={14} />} loading={setup.isPending}>Cadastrar celular</Button>
          </form>
        ) : (
          <div className="space-y-3 text-sm">
            <ol className="list-decimal pl-5 space-y-1 text-muted">
              <li>Abra o Google Authenticator, Authy, 1Password ou similar e escolha <b>adicionar com chave</b> (ou abra o link abaixo no celular).</li>
              <li>Digite a chave, tipo <b>baseado em tempo</b>.</li>
              <li>Informe o código de 6 dígitos que aparecer.</li>
            </ol>
            <div className="rounded-xl bg-field p-3 font-mono text-base tracking-wider break-all select-all">{segredo.secret.match(/.{1,4}/g)?.join(' ')}</div>
            <a href={segredo.otpauthUrl} className="text-accent-ink underline text-[12.5px]">Abrir no app autenticador (no celular)</a>
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); confirm.mutateAsync(code).then(() => { toast.ok('Autenticador ativo'); setSegredo(null); setCode(''); }).catch(toast.err); }}>
              <input required inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} className={cn(inputCls, 'w-32 font-mono tracking-[0.3em] text-center')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <Button type="submit" loading={confirm.isPending}>Confirmar</Button>
            </form>
            <p className="text-[11.5px] text-faint">Guarde a chave num lugar seguro: ela recupera o autenticador se você trocar de celular. Ela não aparece de novo.</p>
          </div>
        )}
      </section>
      <section className={cn(cardCls, 'p-5 space-y-2 text-sm text-muted')}>
        <h3 className="font-semibold text-ink">Validação de saque no Asaas</h3>
        <p>Para que nenhum Pix saia da conta do Asaas sem passar por aqui (nem com a chave da API vazada), ative em <b>Asaas → Integrações → Mecanismos de segurança → Validação de saque via webhook</b> com a URL <code className="font-mono text-ink">/webhooks/asaas/transfer-validation</code> da API e o token de <code className="font-mono">ASAAS_TRANSFER_VALIDATION_TOKEN</code>. Detalhes em docs/37-vogopartners.md.</p>
      </section>
    </div>
  );
}

/** Aba Auditoria: tudo que mexe em dinheiro ou chave fica registrado, com quem e de onde. */
export function AdminAudit() {
  const ev = usePartnerEvents();
  if (ev.isLoading) return <SkeletonRows />;
  return (
    <div className={cn(cardCls, 'overflow-x-auto')}>
      <table className="w-full text-[12.5px] min-w-[640px]">
        <thead className="text-left text-muted border-b border-line"><tr><th className="px-4 py-2 font-medium">Quando</th><th className="px-3 font-medium">O quê</th><th className="px-3 font-medium">Quem</th><th className="px-3 font-medium">IP</th></tr></thead>
        <tbody className="divide-y divide-line">
          {(ev.data ?? []).map((e) => (
            <tr key={e.id} className={cn(e.action === 'transfer.refused' && 'text-danger-ink')}>
              <td className="px-4 py-1.5 tnum whitespace-nowrap">{dataHoraBR(e.createdAt)}</td>
              <td className="px-3">{EVENT_LABEL[e.action] ?? e.action}</td>
              <td className="px-3">{e.actorName ?? 'sistema'}</td>
              <td className="px-3 text-faint font-mono">{e.ip ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
