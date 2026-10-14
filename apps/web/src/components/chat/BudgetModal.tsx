'use client';
import { useState } from 'react';
import { Plus, Trash2, Copy, FileText, Check, Undo2, CornerDownLeft } from 'lucide-react';
import { BUDGET_DEFAULT_HOURS, BUDGET_MAX_ITEMS, BUDGET_STATUS_LABEL, budgetTotal, type BudgetItem, type BudgetStatus } from '@atendo/shared';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { budgetLink, useBudgets, useConversation, useCreateBudget, usePixKeys, useSetBudgetStatus, type Budget } from '@/lib/hooks';

/**
 * Orçamento rápido no chat (docs/orcamentos.md).
 *
 * Itens, valores e chave Pix ficam numa página pública; no WhatsApp vai só um texto genérico
 * com o link. Mensagem com lista de medicamento e valor é o tipo de conteúdo que derruba
 * número — o link não. O texto entra no campo, não sai sozinho: o atendente revisa e envia.
 */

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const VALIDADES = [
  { h: 24, label: '24 horas' },
  { h: 48, label: '48 horas' },
  { h: 72, label: '3 dias' },
  { h: 168, label: '7 dias' },
];
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
  const criar = useCreateBudget();
  const [itens, setItens] = useState<BudgetItem[]>([vazio()]);
  const [pixKeyId, setPixKeyId] = useState('');
  const [paymentUrl, setPaymentUrl] = useState('');
  const [note, setNote] = useState('');
  const [validHours, setValidHours] = useState(BUDGET_DEFAULT_HOURS);
  const chaves = pix.data ?? [];
  // a primeira chave já vem escolhida: é o caso de quase todo mundo
  const chave = pixKeyId === '' ? chaves[0]?.id ?? 'none' : pixKeyId;

  const mudar = (i: number, p: Partial<BudgetItem>) => setItens((l) => l.map((it, j) => (j === i ? { ...it, ...p } : it)));
  const validos = itens.filter((i) => i.name.trim());
  const total = budgetTotal(validos);

  async function gerar() {
    if (!validos.length) return toast.warn('Adicione ao menos um item com nome');
    const url = paymentUrl.trim();
    if (chave === 'none' && !url) return toast.warn('Escolha uma chave Pix ou informe um link de pagamento');
    if (url && !/^https:\/\//i.test(url)) return toast.warn('O link de pagamento precisa começar com https://');
    try {
      const b = await criar.mutateAsync({
        conversationId,
        items: validos.map((i) => ({ name: i.name.trim(), dosage: i.dosage?.trim() || undefined, quantity: i.quantity, unitPrice: i.unitPrice })),
        pixKeyId: chave !== 'none' ? chave : undefined,
        paymentUrl: url || undefined,
        note: note.trim() || undefined,
        validHours,
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

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Chave Pix" hint={chaves.length ? undefined : 'Nenhuma chave cadastrada (Configurações → Chaves Pix).'}>
          <select className={inputCls} value={chave} onChange={(e) => setPixKeyId(e.target.value)}>
            {chaves.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}
            <option value="none">Sem chave Pix</option>
          </select>
        </Field>
        <Field label="Link de pagamento (opcional)">
          <input className={inputCls} placeholder="https://…" value={paymentUrl} maxLength={500} onChange={(e) => setPaymentUrl(e.target.value)} />
        </Field>
        <Field label="Validade do link">
          <select className={inputCls} value={validHours} onChange={(e) => setValidHours(Number(e.target.value))}>
            {VALIDADES.map((v) => <option key={v.h} value={v.h}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Observação (opcional)" hint="Aparece na página do cliente.">
          <input className={inputCls} placeholder="Ex.: entrega amanhã pela manhã" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button onClick={gerar} loading={criar.isPending} loadingText="Gerando…">Gerar link</Button>
      </div>
    </div>
  );
}

const STATUS_CLS: Record<BudgetStatus, string> = {
  PENDING: 'bg-warn-soft text-warn-ink',
  PAID: 'bg-ok-soft text-ok',
  EXPIRED: 'bg-field text-muted',
};

function ListaOrcamentos({ conversationId, budgets, carregando, onInserir }: { conversationId: string; budgets: Budget[]; carregando: boolean; onInserir: (hash: string) => void }) {
  const status = useSetBudgetStatus();
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
            {b.status === 'PAID'
              ? <Button variant="ghost" size="sm" icon={<Undo2 size={13} />} loading={status.isPending && status.variables?.id === b.id} onClick={() => marcar(b, 'PENDING')}>Desfazer pago</Button>
              : <Button variant="success" size="sm" icon={<Check size={13} />} loading={status.isPending && status.variables?.id === b.id} onClick={() => marcar(b, 'PAID')}>Marcar como pago</Button>}
          </div>
        </li>
      ))}
    </ul>
  );
}
