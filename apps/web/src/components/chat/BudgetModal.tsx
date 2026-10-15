'use client';
import { useState } from 'react';
import { Plus, Trash2, Copy, FileText, Check, Undo2, CornerDownLeft, Zap } from 'lucide-react';
import { BUDGET_DEFAULT_VALIDITY, BUDGET_GRACE_MINUTES, BUDGET_MAX_ITEMS, BUDGET_STATUS_LABEL, BUDGET_VALIDITY, BUDGET_VALIDITY_LABEL, budgetTotal, type BudgetItem, type BudgetStatus, type BudgetValidity } from '@atendo/shared';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { cn, formatDoc } from '@/lib/utils';
import { budgetLink, useBudgets, useCan, useConversation, useCreateBudget, usePaymentGateway, usePixKeys, useRefundBudget, useSetBudgetStatus, type Budget } from '@/lib/hooks';

/**
 * Orçamento rápido no chat (docs/orcamentos.md).
 *
 * Itens, valores e chave Pix ficam numa página pública; no WhatsApp vai só um texto genérico
 * com o link. Mensagem com lista de medicamento e valor é o tipo de conteúdo que derruba
 * número — o link não. O texto entra no campo, não sai sozinho: o atendente revisa e envia.
 */

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const vazio = (): BudgetItem => ({ name: '', dosage: '', quantity: 1, unitPrice: 0 });

export function BudgetModal({ open, onClose, conversationId, onInserir }: { open: boolean; onClose: () => void; conversationId: string; onInserir: (texto: string) => void }) {
  const [aba, setAba] = useState<'novo' | 'lista'>('novo');
  const lista = useBudgets(open ? conversationId : null);
  const n = lista.data?.length ?? 0;
  const conv = useConversation(conversationId).data;
  const primeiroNome = conv?.contact.name?.trim().split(/\s+/)[0] ?? '';

  // texto genérico: nada de item, valor ou chave na conversa
  const mensagem = (hash: string) =>
    `Olá${primeiroNome ? ` ${primeiroNome}` : ''}, acesse o link para visualizar os detalhes do seu orçamento e opções de pagamento: ${budgetLink(hash)}`;
  const inserir = (hash: string) => { onInserir(mensagem(hash)); onClose(); };

  return (
    <Modal open={open} onClose={onClose} title="Orçamento / pedido" width="max-w-2xl">
      <div className="flex gap-1 mb-4 border-b border-line -mt-1">
        <Aba ativa={aba === 'novo'} onClick={() => setAba('novo')}>Novo orçamento</Aba>
        <Aba ativa={aba === 'lista'} onClick={() => setAba('lista')}>Desta conversa{n ? ` (${n})` : ''}</Aba>
      </div>
      {aba === 'novo'
        ? <NovoOrcamento conversationId={conversationId} onCriado={(b) => inserir(b.hash)} />
        : <ListaOrcamentos conversationId={conversationId} budgets={lista.data ?? []} carregando={lista.isLoading} onInserir={inserir} />}
    </Modal>
  );
}

function Aba({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('px-3 py-2 text-sm -mb-px border-b-2', ativa ? 'border-accent text-ink font-medium' : 'border-transparent text-muted hover:text-ink')}>
      {children}
    </button>
  );
}

function NovoOrcamento({ conversationId, onCriado }: { conversationId: string; onCriado: (b: Budget) => void }) {
  const pix = usePixKeys();
  const gw = usePaymentGateway();
  const criar = useCreateBudget();
  // Pix automático disponível (plano + Asaas conectado): já vem ligado — é o caminho sem comprovante
  const podeAuto = !!gw.data?.feature && !!gw.data.connected;
  const [autoEscolha, setAuto] = useState<boolean | null>(null);
  const auto = podeAuto && (autoEscolha ?? true);
  // mini cadastro: vem da ficha; digitado aqui, a API grava na ficha junto com o orçamento
  const docFicha = useConversation(conversationId).data?.contact.document ?? '';
  const [doc, setDoc] = useState<string | null>(null);
  const documento = doc ?? formatDoc(docFicha);
  const [itens, setItens] = useState<BudgetItem[]>([vazio()]);
  const [pixKeyId, setPixKeyId] = useState('');
  const [paymentUrl, setPaymentUrl] = useState('');
  const [note, setNote] = useState('');
  const [validity, setValidity] = useState<BudgetValidity>(BUDGET_DEFAULT_VALIDITY);
  const chaves = pix.data ?? [];
  // a primeira chave já vem escolhida: é o caso de quase todo mundo
  const chave = pixKeyId === '' ? chaves[0]?.id ?? 'none' : pixKeyId;

  const mudar = (i: number, p: Partial<BudgetItem>) => setItens((l) => l.map((it, j) => (j === i ? { ...it, ...p } : it)));
  const validos = itens.filter((i) => i.name.trim());
  const total = budgetTotal(validos);

  async function gerar() {
    if (!validos.length) return toast.warn('Adicione ao menos um item com nome');
    const url = paymentUrl.trim();
    if (!auto && chave === 'none' && !url) return toast.warn('Escolha uma chave Pix ou informe um link de pagamento');
    if (url && !/^https:\/\//i.test(url)) return toast.warn('O link de pagamento precisa começar com https://');
    const digitos = documento.replace(/\D/g, '');
    if (auto && digitos.length !== 11 && digitos.length !== 14) return toast.warn('Informe o CPF (11 dígitos) ou CNPJ (14 dígitos) do cliente para o Pix automático');
    try {
      const b = await criar.mutateAsync({
        conversationId,
        items: validos.map((i) => ({ name: i.name.trim(), dosage: i.dosage?.trim() || undefined, quantity: i.quantity, unitPrice: i.unitPrice })),
        pixKeyId: !auto && chave !== 'none' ? chave : undefined,
        paymentUrl: !auto ? url || undefined : undefined,
        autoPix: auto || undefined,
        cpfCnpj: auto && digitos !== docFicha ? digitos : undefined,
        note: note.trim() || undefined,
        validity,
      });
      toast.ok('Link gerado — revise a mensagem no campo e envie');
      onCriado(b);
    } catch (e) { toast.err(e); }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="hidden sm:grid grid-cols-[1fr_1fr_4.5rem_8rem_2rem] gap-2 text-xs text-muted px-0.5">
          <span>Item</span><span>Dosagem / apresentação</span><span>Qtd.</span><span>Valor unit.</span><span />
        </div>
        {itens.map((it, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_4.5rem_8rem_2rem] gap-2 items-center">
            <input className={cn(inputCls, 'col-span-2 sm:col-span-1')} placeholder="Ex.: Dipirona" value={it.name} maxLength={120} onChange={(e) => mudar(i, { name: e.target.value })} />
            <input className={cn(inputCls, 'col-span-2 sm:col-span-1')} placeholder="Ex.: 500 mg, 30 comp." value={it.dosage ?? ''} maxLength={120} onChange={(e) => mudar(i, { dosage: e.target.value })} />
            <input className={cn(inputCls, 'text-right tnum')} type="number" min={1} max={9999} value={it.quantity} onChange={(e) => mudar(i, { quantity: Math.max(1, Math.min(9999, Math.floor(Number(e.target.value) || 1))) })} aria-label="Quantidade" />
            <MoneyInput value={it.unitPrice} onChange={(v) => mudar(i, { unitPrice: v ?? 0 })} aria-label="Valor unitário" />
            <button type="button" onClick={() => setItens((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [vazio()]))} className="text-faint hover:text-danger justify-self-center" title="Remover item" aria-label="Remover item">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" size="sm" icon={<Plus size={14} />} disabled={itens.length >= BUDGET_MAX_ITEMS} onClick={() => setItens((l) => [...l, vazio()])}>Adicionar item</Button>
          <span className="text-sm text-muted">Total <b className="text-ink tnum text-base ml-1">{brl(total)}</b></span>
        </div>
      </div>

      {podeAuto && (
        <label className="flex items-start gap-2 rounded-xl border border-line px-3 py-2.5 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span className="text-sm">
            <span className="font-medium text-ink inline-flex items-center gap-1"><Zap size={14} className="text-ok" /> Pix automático</span>
            <span className="block text-xs text-muted">O link já abre com o Pix no valor exato, e o orçamento fica “Pago” sozinho quando o pagamento cai — sem comprovante.</span>
          </span>
        </label>
      )}
      {auto && (
        <Field label="CPF / CNPJ do cliente" hint={docFicha ? 'Da ficha do contato. Alterado aqui, a ficha é atualizada.' : 'O Asaas exige para gerar o Pix. Fica salvo na ficha do contato.'}>
          <input className={cn(inputCls, 'tnum')} inputMode="numeric" placeholder="000.000.000-00" value={documento} maxLength={18} onChange={(e) => setDoc(formatDoc(e.target.value))} />
        </Field>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {!auto && <Field label="Chave Pix" hint={chaves.length ? undefined : 'Nenhuma chave cadastrada (Configurações → Chaves Pix).'}>
          <select className={inputCls} value={chave} onChange={(e) => setPixKeyId(e.target.value)}>
            {chaves.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}
            <option value="none">Sem chave Pix</option>
          </select>
        </Field>}
        {!auto && <Field label="Link de pagamento (opcional)">
          <input className={inputCls} placeholder="https://…" value={paymentUrl} maxLength={500} onChange={(e) => setPaymentUrl(e.target.value)} />
        </Field>}
        <Field label="Validade do link" hint={`No vencimento o cliente não vê mais o Pix${auto ? `; a cobrança é cancelada ${BUDGET_GRACE_MINUTES} min depois` : ''}.`}>
          <select className={inputCls} value={validity} onChange={(e) => setValidity(e.target.value as BudgetValidity)}>
            {BUDGET_VALIDITY.map((v) => <option key={v} value={v}>{BUDGET_VALIDITY_LABEL[v]}</option>)}
          </select>
        </Field>
        <Field label="Observação (opcional)" hint="Aparece na página do cliente.">
          <input className={inputCls} placeholder="Ex.: entrega amanhã pela manhã" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button onClick={gerar} loading={criar.isPending} loadingText={auto ? 'Gerando Pix…' : 'Gerando…'}>Gerar link</Button>
      </div>
    </div>
  );
}

const STATUS_CLS: Record<BudgetStatus, string> = {
  PENDING: 'bg-warn-soft text-warn-ink',
  PAID: 'bg-ok-soft text-ok',
  EXPIRED: 'bg-field text-muted',
  REFUNDED: 'bg-danger-soft text-danger-ink',
};

function ListaOrcamentos({ conversationId, budgets, carregando, onInserir }: { conversationId: string; budgets: Budget[]; carregando: boolean; onInserir: (hash: string) => void }) {
  const status = useSetBudgetStatus();
  const estornar = useRefundBudget();
  const podeEstornar = useCan('settings.manage');
  if (carregando) return <p className="text-sm text-faint">Carregando…</p>;
  if (!budgets.length) return <p className="text-sm text-faint">Nenhum orçamento gerado nesta conversa.</p>;

  const copiar = (hash: string) => navigator.clipboard.writeText(budgetLink(hash)).then(() => toast.ok('Link copiado'), toast.err);
  const marcar = (b: Budget, s: 'PENDING' | 'PAID') =>
    status.mutateAsync({ conversationId, id: b.id, status: s }).then(() => toast.ok(s === 'PAID' ? 'Marcado como pago' : 'Pagamento desfeito'), toast.err);

  return (
    <ul className="space-y-2">
      {budgets.map((b) => (
        <li key={b.id} className="rounded-xl border border-line p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <b className="tnum">{brl(b.totalValue)}</b>
            <span className={cn('text-[11px] rounded-full px-2 py-0.5', STATUS_CLS[b.status])}>{BUDGET_STATUS_LABEL[b.status]}</span>
            {b.status === 'PENDING' && <span className="text-[11px] text-muted">vence {new Date(b.expiresAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>}
            {(b.status === 'PAID' || b.status === 'REFUNDED') && b.paidAt && new Date(b.paidAt) > new Date(b.expiresAt) && <span className="text-[11px] rounded-full px-2 py-0.5 bg-warn-soft text-warn-ink" title="O pagamento chegou depois do vencimento — confira se o pedido ainda vale">Pago após o vencimento</span>}
            {b.status === 'PAID' && b.paidVia === 'asaas' && <span className="text-[11px] rounded-full px-2 py-0.5 bg-ok-soft text-ok">Baixa automática</span>}
            {b.status !== 'PAID' && b.autoPix && <span className="text-[11px] rounded-full px-2 py-0.5 bg-field text-muted">Pix automático</span>}
            {b.receipt && <span className="text-[11px] rounded-full px-2 py-0.5 bg-accent-soft text-accent-ink">Comprovante recebido</span>}
            <span className="flex-1" />
            <span className="text-[11px] text-faint">
              {new Date(b.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {b.user.name.split(' ')[0]}
            </span>
          </div>
          <p className="text-xs text-muted truncate">{b.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {b.status === 'PENDING' && <Button variant="ghost" size="sm" icon={<CornerDownLeft size={13} />} onClick={() => onInserir(b.hash)}>Inserir no campo</Button>}
            <Button variant="ghost" size="sm" icon={<Copy size={13} />} onClick={() => copiar(b.hash)}>Copiar link</Button>
            {b.receipt && (
              <a href={b.receipt.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-line text-ink hover:bg-field">
                <FileText size={13} /> Ver comprovante
              </a>
            )}
            {b.status === 'PAID' && b.paidVia !== 'asaas' && !b.absorbed && (
              <Button variant="ghost" size="sm" icon={<Undo2 size={13} />} loading={status.isPending && status.variables?.id === b.id} onClick={() => marcar(b, 'PENDING')}>Desfazer pago</Button>
            )}
            {b.status === 'PAID' && podeEstornar && (
              <Button variant="subtle" size="sm" loading={estornar.isPending && estornar.variables?.id === b.id}
                onClick={() => { if (confirm(b.paidVia === 'asaas' ? 'Estornar? O Asaas devolve o dinheiro ao cliente e a venda sai da meta.' : 'Registrar estorno? A venda sai da meta e do faturamento.')) estornar.mutateAsync({ conversationId, id: b.id }).then(() => toast.ok('Estorno registrado'), toast.err); }}>
                Estornar
              </Button>
            )}
            {(b.status === 'PENDING' || b.status === 'EXPIRED') && (
              <Button variant="success" size="sm" icon={<Check size={13} />} loading={status.isPending && status.variables?.id === b.id} onClick={() => marcar(b, 'PAID')}>Marcar como pago</Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
