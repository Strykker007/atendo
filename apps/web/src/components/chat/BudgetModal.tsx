'use client';
import { useState } from 'react';
import { Plus, Trash2, Copy, FileText, Check, Undo2, CornerDownLeft, Zap, Send, Link2, X, Receipt, Lock, CreditCard } from 'lucide-react';
import { BUDGET_DEFAULT_VALIDITY, BUDGET_GRACE_MINUTES, BUDGET_MAX_ITEMS, BUDGET_STATUS_LABEL, BUDGET_VALIDITY, BUDGET_VALIDITY_LABEL, budgetApprovedText, budgetLinkText, budgetQuoteLinkText, budgetQuoteShowsItems, budgetQuoteText, budgetRiskTerms, budgetTotal, type BudgetItem, type BudgetStatus, type BudgetValidity } from '@atendo/shared';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { cn, formatDoc } from '@/lib/utils';
import { budgetLink, useApproveBudget, useBudgets, useCan, useConversation, useCreateBudget, usePaymentGateway, usePixKeys, useRefundBudget, useSetBudgetStatus, useTenantSettings, type Budget } from '@/lib/hooks';

/**
 * Orçamento rápido no chat (docs/orcamentos.md). Dois jeitos:
 *
 * - **Enviar orçamento**: a mensagem com itens e valores vai na hora, com o número ("Nº 42"). O
 *   cliente aprova, o atalho acima do campo (`OrcamentosAguardando`) libera o link DAQUELE número.
 *   Item sensível (`budgetRiskTerms`: dosagem, controlado, emagrecedor…) tira os itens do texto:
 *   vão só número e total, e os itens ficam no link (sem pagamento até a aprovação).
 * - **Só o link**: itens, valores e chave Pix ficam na página; no WhatsApp vai um texto genérico.
 *   Mensagem com lista de medicamento e valor é o tipo de conteúdo que derruba número — o link não.
 *
 * Chave Pix e link nunca vão junto do orçamento por texto.
 */

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** mesma altura em todo campo do formulário: select e input nativos não batem sozinhos */
const campo = cn(inputCls, 'h-[38px]');
const vazio = (): BudgetItem => ({ name: '', dosage: '', quantity: 1, unitPrice: 0 });
const primeiroNomeDe = (nome?: string | null) => nome?.trim().split(/\s+/)[0] ?? '';
const resumoItens = (b: Budget) => b.items.map((i) => `${i.quantity}× ${i.name}`).join(', ');

/** Texto com o link: aprovado por texto leva número e total (o cliente confere antes de pagar); só o link, o genérico. */
function textoDoLink(b: Budget, primeiroNome: string) {
  if (b.number && b.quotedAt) return budgetLinkText({ number: b.number, totalValue: b.totalValue, discountValue: b.discountValue, discountPercent: b.discountPercent }, budgetLink(b.hash), primeiroNome || undefined);
  // texto genérico: nada de item, valor ou chave na conversa
  return `Olá${primeiroNome ? ` ${primeiroNome}` : ''}, acesse o link para visualizar os detalhes do seu orçamento e opções de pagamento: ${budgetLink(b.hash)}`;
}

/**
 * Cliente aprovou → libera o link do orçamento ESCOLHIDO e envia. A confirmação repete número,
 * total e itens: com dois orçamentos na conversa, mandar o link do outro é cobrança errada.
 */
function useEnviarLink(conversationId: string, onEnviar: (texto: string) => Promise<unknown>) {
  const aprovar = useApproveBudget();
  const primeiroNome = primeiroNomeDe(useConversation(conversationId).data?.contact.name);
  const enviar = async (b: Budget) => {
    if (!confirm(`Enviar o link de pagamento do ORÇAMENTO Nº ${b.number} — ${brl(b.totalValue)}?\n\n${b.items.map((i) => `${i.quantity}× ${i.name}`).join('\n')}`)) return false;
    let aprovado: Budget;
    try { aprovado = await aprovar.mutateAsync({ conversationId, id: b.id }); } catch (e) { toast.err(e); return false; }
    try {
      await onEnviar(textoDoLink(aprovado, primeiroNome));
      toast.ok(`Link do orçamento Nº ${b.number} enviado`);
      return true;
    } catch (e) {
      toast.err(e);
      toast.warn('O link foi liberado mas não saiu. Em Orçamento → Desta conversa, use “Inserir no campo”.');
      return false;
    }
  };
  /** cartão ou dinheiro: aprova sem Pix e manda só a confirmação (número e total, sem link) */
  const semLink = async (b: Budget) => {
    if (!confirm(`Aprovar o ORÇAMENTO Nº ${b.number} — ${brl(b.totalValue)} para pagamento em cartão ou dinheiro?\n\nO link não é enviado; marque como pago quando receber.`)) return false;
    try { await aprovar.mutateAsync({ conversationId, id: b.id, link: false }); } catch (e) { toast.err(e); return false; }
    try {
      await onEnviar(budgetApprovedText({ number: b.number!, totalValue: b.totalValue, discountValue: b.discountValue, discountPercent: b.discountPercent }, primeiroNome || undefined));
      toast.ok(`Orçamento Nº ${b.number} aprovado`);
      return true;
    } catch (e) { toast.err(e); return false; }
  };
  return { enviar, semLink, enviando: aprovar.isPending && aprovar.variables?.link !== false ? aprovar.variables?.id : undefined, aprovandoSemLink: aprovar.isPending && aprovar.variables?.link === false ? aprovar.variables?.id : undefined };
}

export function BudgetModal({ open, onClose, conversationId, onInserir, onEnviar }: { open: boolean; onClose: () => void; conversationId: string; onInserir: (texto: string) => void; onEnviar: (texto: string) => Promise<unknown> }) {
  const [aba, setAba] = useState<'novo' | 'lista'>('novo');
  const lista = useBudgets(open ? conversationId : null);
  const n = lista.data?.length ?? 0;
  const primeiroNome = primeiroNomeDe(useConversation(conversationId).data?.contact.name);
  const inserir = (b: Budget) => { onInserir(textoDoLink(b, primeiroNome)); onClose(); };
  const link = useEnviarLink(conversationId, onEnviar);

  return (
    <Modal open={open} onClose={onClose} title="Orçamento / pedido" width="max-w-2xl">
      <div className="flex gap-1 mb-4 border-b border-line -mt-1">
        <Aba ativa={aba === 'novo'} onClick={() => setAba('novo')}>Novo orçamento</Aba>
        <Aba ativa={aba === 'lista'} onClick={() => setAba('lista')}>Desta conversa{n ? ` (${n})` : ''}</Aba>
      </div>
      {aba === 'novo'
        ? <NovoOrcamento conversationId={conversationId} onLink={inserir} onEnviar={onEnviar} onEnviado={onClose} />
        : <ListaOrcamentos conversationId={conversationId} budgets={lista.data ?? []} carregando={lista.isLoading} onInserir={inserir} link={link} />}
    </Modal>
  );
}

/**
 * Atalho acima do campo: orçamentos enviados por texto esperando o cliente aprovar. Um clique
 * aprova o orçamento daquela linha (Pix: com link; cartão/dinheiro: sem). Com mais de um, o número
 * que o cliente citar fica destacado — é ele que decide qual orçamento vai.
 */
export function OrcamentosAguardando({ conversationId, ultimaDoContato, onEnviar }: { conversationId: string; ultimaDoContato?: string | null; onEnviar: (texto: string) => Promise<unknown> }) {
  const lista = useBudgets(conversationId);
  const status = useSetBudgetStatus();
  const link = useEnviarLink(conversationId, onEnviar);
  const abertos = (lista.data ?? []).filter((b) => b.awaitingApproval && b.status === 'PENDING' && b.number);
  if (!abertos.length) return null;
  const resposta = ultimaDoContato ?? '';
  // o cliente aprova respondendo a forma de pagamento (ou "aprovo")
  const aprovou = /aprov|\bpix\b|cart[aã]o|cr[eé]dito|d[eé]bito|dinheiro|esp[eé]cie/i.test(resposta);
  // com mais de um aberto, o número citado manda; com um só, basta a resposta
  const citado = (b: Budget) => aprovou && (new RegExp(`(^|\\D)${b.number}(\\D|$)`).test(resposta) || abertos.length === 1);
  // a forma de pagamento na resposta decide o botão em destaque: só Pix leva link
  const pagaPorFora = /cart[aã]o|cr[eé]dito|d[eé]bito|dinheiro|esp[eé]cie/i.test(resposta) && !/\bpix\b/i.test(resposta);
  const descartar = (b: Budget) => {
    if (confirm(`Descartar o orçamento Nº ${b.number}? Ele sai daqui e o link dele não pode mais ser enviado.`)) status.mutateAsync({ conversationId, id: b.id, status: 'EXPIRED' }).catch(toast.err);
  };

  return (
    <div className="space-y-1">
      {abertos.length > 1 && <p className="text-[11px] text-warn-ink px-1">{abertos.length} orçamentos esperando aprovação — confira qual número o cliente aprovou.</p>}
      {abertos.map((b) => (
        <div key={b.id} className={cn('flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm', citado(b) ? 'border-ok bg-ok-soft' : 'border-line bg-field')}>
          <Receipt size={15} className={citado(b) ? 'text-ok shrink-0' : 'text-muted shrink-0'} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <b className="tnum">Nº {b.number}</b>
              <span className="tnum">{brl(b.totalValue)}</span>
              <span className={cn('text-[11px] rounded-full px-2 py-0.5', citado(b) ? 'bg-ok text-white' : 'bg-warn-soft text-warn-ink')}>{citado(b) ? 'Cliente aprovou' : 'Aguardando aprovação'}</span>
            </div>
            <p className="text-xs text-muted truncate">{resumoItens(b)}</p>
          </div>
          <Button size="sm" variant={citado(b) && !pagaPorFora ? 'success' : 'ghost'} icon={<Link2 size={13} />} loading={link.enviando === b.id} onClick={() => link.enviar(b)} title="Pix: aprova e envia o link de pagamento">
            <span className="hidden sm:inline">Pix: enviar link</span><span className="sm:hidden">Pix</span>
          </Button>
          <Button size="sm" variant={citado(b) && pagaPorFora ? 'success' : 'ghost'} icon={<CreditCard size={13} />} loading={link.aprovandoSemLink === b.id} onClick={() => link.semLink(b)} title="Cartão ou dinheiro: aprova sem enviar link">
            <span className="hidden sm:inline">Cartão/dinheiro</span>
          </Button>
          <button type="button" onClick={() => descartar(b)} className="text-faint hover:text-danger p-1" title="Descartar orçamento" aria-label={`Descartar orçamento Nº ${b.number}`}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Aba({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('px-3 py-2 text-sm -mb-px border-b-2', ativa ? 'border-accent text-ink font-medium' : 'border-transparent text-muted hover:text-ink')}>
      {children}
    </button>
  );
}

/** rótulos dos itens: quem vende (farmácia) mantém os de sempre; operação sem venda, genéricos */
const ROTULOS_ITEM = {
  venda: { detalhe: 'Dosagem / apresentação', exNome: 'Ex.: Dipirona', exDetalhe: 'Ex.: 500 mg, 30 comp.' },
  servico: { detalhe: 'Detalhe', exNome: 'Ex.: Manutenção do portão', exDetalhe: 'Ex.: modelo, tamanho, prazo' },
} as const;

/** Vencimento aproximado só para a prévia — o de verdade vem da API, no fuso da empresa. */
function vencimentoPrevia(v: BudgetValidity) {
  if (v !== 'end_of_day') return new Date(Date.now() + Number(v.replace('h', '')) * 3600_000);
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d;
}

function NovoOrcamento({ conversationId, onLink, onEnviar, onEnviado }: { conversationId: string; onLink: (b: Budget) => void; onEnviar: (texto: string) => Promise<unknown>; onEnviado: () => void }) {
  const ajustes = useTenantSettings().data;
  const tz = ajustes?.timezone;
  // Configurações → Atendimento → Orçamento por mensagem
  const modoItens = ajustes?.budgetQuoteItems ?? 'link';
  // orçamento por mensagem é opcional da empresa: desligado (padrão) = só o link
  const porMensagem = !!ajustes?.budgetQuoteEnabled;
  const setStatus = useSetBudgetStatus();
  const [enviando, setEnviando] = useState(false);
  const [verPrevia, setVerPrevia] = useState(false);
  const primeiroNome = primeiroNomeDe(useConversation(conversationId).data?.contact.name);
  const rot = ROTULOS_ITEM[(useTenantSettings().data?.salesEnabled ?? true) ? 'venda' : 'servico'];
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
  const subtotal = budgetTotal(validos);
  // desconto em R$ ou %: aparece no texto e na página, para o cliente ver que já ganhou (e não pedir de novo)
  const [tipoDesc, setTipoDesc] = useState<'valor' | 'pct'>('valor');
  const [descValor, setDescValor] = useState(0);
  const [descPct, setDescPct] = useState('');
  const pctNum = Math.min(99.99, Math.max(0, Number(descPct.replace(',', '.')) || 0));
  const desconto = tipoDesc === 'pct' ? Math.round(subtotal * pctNum) / 100 : descValor;
  const descontoOk = desconto >= 0 && (desconto === 0 || desconto < subtotal);
  const total = Math.round((subtotal - (descontoOk ? desconto : 0)) * 100) / 100;
  const sensiveis = budgetRiskTerms(validos, note);
  const itensNoTexto = budgetQuoteShowsItems(modoItens, validos, note);

  /** `quote`: envia o orçamento por texto (link só depois da aprovação); senão, só o link no campo. */
  async function gerar(quote: boolean) {
    if (!validos.length) return toast.warn('Adicione ao menos um item com nome');
    if (!descontoOk) return toast.warn('O desconto precisa ser menor que a soma dos itens');
    const url = paymentUrl.trim();
    if (!auto && chave === 'none' && !url) return toast.warn('Escolha uma chave Pix ou informe um link de pagamento');
    if (url && !/^https:\/\//i.test(url)) return toast.warn('O link de pagamento precisa começar com https://');
    const digitos = documento.replace(/\D/g, '');
    if (auto && digitos.length !== 11 && digitos.length !== 14) return toast.warn('Informe o CPF (11 dígitos) ou CNPJ (14 dígitos) do contato para o Pix automático');
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
        quote: quote || undefined,
        ...(tipoDesc === 'pct' ? (pctNum > 0 ? { discountPercent: pctNum } : {}) : (desconto > 0 ? { discount: desconto } : {})),
      });
      if (!quote) {
        toast.ok('Link gerado — revise a mensagem no campo e envie');
        return onLink(b);
      }
      setEnviando(true);
      try {
        // decide pelo que foi salvo (o mesmo que a tela mostrou)
        const opts = { firstName: primeiroNome || undefined, timeZone: tz };
        await onEnviar(!budgetQuoteShowsItems(modoItens, b.items, b.note)
          ? budgetQuoteLinkText({ ...b, number: b.number! }, budgetLink(b.hash), opts)
          : budgetQuoteText({ ...b, number: b.number! }, opts));
      } catch (e) {
        // não saiu (janela, cota, número): descarta para não ficar no atalho um orçamento que o cliente nunca viu
        await setStatus.mutateAsync({ conversationId, id: b.id, status: 'EXPIRED' }).catch(() => undefined);
        throw e;
      } finally { setEnviando(false); }
      toast.ok(`Orçamento Nº ${b.number} enviado — quando o cliente aprovar, o link sai pelo atalho acima do campo`);
      onEnviado();
    } catch (e) { toast.err(e); }
  }

  const rascunho = { number: '…', items: validos, totalValue: total, discountValue: desconto > 0 ? desconto : 0, discountPercent: tipoDesc === 'pct' && pctNum > 0 ? pctNum : null, expiresAt: vencimentoPrevia(validity), note: note.trim() || null };
  const optsPrevia = { firstName: primeiroNome || undefined, timeZone: tz };
  const previa = !itensNoTexto ? budgetQuoteLinkText(rascunho, budgetLink('…'), optsPrevia) : budgetQuoteText(rascunho, optsPrevia);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="hidden sm:grid grid-cols-[1fr_1fr_4.5rem_8rem_2rem] gap-2 text-xs text-muted px-0.5">
          <span>Item</span><span>{rot.detalhe}</span><span>Qtd.</span><span>Valor unit.</span><span />
        </div>
        {itens.map((it, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_4.5rem_8rem_2rem] gap-2 items-center">
            <input className={cn(campo, 'col-span-2 sm:col-span-1')} placeholder={rot.exNome} value={it.name} maxLength={120} onChange={(e) => mudar(i, { name: e.target.value })} />
            <input className={cn(campo, 'col-span-2 sm:col-span-1')} placeholder={rot.exDetalhe} value={it.dosage ?? ''} maxLength={120} onChange={(e) => mudar(i, { dosage: e.target.value })} />
            <input className={cn(campo, 'text-right tnum')} type="number" min={1} max={9999} value={it.quantity} onChange={(e) => mudar(i, { quantity: Math.max(1, Math.min(9999, Math.floor(Number(e.target.value) || 1))) })} aria-label="Quantidade" />
            <MoneyInput value={it.unitPrice} onChange={(v) => mudar(i, { unitPrice: v ?? 0 })} aria-label="Valor unitário" />
            <button type="button" onClick={() => setItens((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [vazio()]))} className="text-faint hover:text-danger justify-self-center" title="Remover item" aria-label="Remover item">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" size="sm" icon={<Plus size={14} />} disabled={itens.length >= BUDGET_MAX_ITEMS} onClick={() => setItens((l) => [...l, vazio()])}>Adicionar item</Button>
          <span className="text-sm text-muted">{desconto > 0 && descontoOk ? <>Subtotal <span className="tnum">{brl(subtotal)}</span> · </> : null}Total <b className="text-ink tnum text-base ml-1">{brl(total)}</b></span>
        </div>
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted">Desconto</span>
          <div className="grid grid-cols-2 rounded-lg bg-field p-0.5 text-xs font-semibold h-[38px]" role="group" aria-label="Tipo de desconto">
            {(['valor', 'pct'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTipoDesc(t)} className={cn('rounded-md px-2.5', tipoDesc === t ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink')}>{t === 'valor' ? 'R$' : '%'}</button>
            ))}
          </div>
          <div className="w-32">
            {tipoDesc === 'valor'
              ? <MoneyInput value={descValor} onChange={(v) => setDescValor(v ?? 0)} aria-label="Desconto em reais" />
              : <div className="relative"><input className={cn(campo, 'pr-7 text-right tnum')} inputMode="decimal" placeholder="0" value={descPct} maxLength={5} onChange={(e) => setDescPct(e.target.value.replace(/[^\d,.]/g, ''))} aria-label="Desconto em percentual" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-faint">%</span></div>}
          </div>
        </div>
        {tipoDesc === 'pct' && pctNum > 0 && descontoOk && <p className="text-xs text-muted text-right">{pctNum.toLocaleString('pt-BR')}% = {brl(desconto)}</p>}
        {!descontoOk && <p className="text-xs text-danger-ink text-right">O desconto precisa ser menor que a soma dos itens.</p>}
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
        <Field label="CPF / CNPJ do contato" hint={docFicha ? 'Da ficha do contato. Alterado aqui, a ficha é atualizada.' : 'O Asaas exige para gerar o Pix. Fica salvo na ficha do contato.'}>
          <input className={cn(campo, 'tnum')} inputMode="numeric" placeholder="000.000.000-00" value={documento} maxLength={18} onChange={(e) => setDoc(formatDoc(e.target.value))} />
        </Field>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {!auto && <Field label="Chave Pix" hint={chaves.length ? undefined : 'Nenhuma chave cadastrada (Configurações → Chaves Pix).'}>
          <select className={cn(campo, 'py-0')} value={chave} onChange={(e) => setPixKeyId(e.target.value)}>
            {chaves.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}
            <option value="none">Sem chave Pix</option>
          </select>
        </Field>}
        {!auto && <Field label="Link de pagamento (opcional)">
          <input className={campo} placeholder="https://…" value={paymentUrl} maxLength={500} onChange={(e) => setPaymentUrl(e.target.value)} />
        </Field>}
        <Field label="Validade" hint={`Recomeça ao aprovar. Vencido, o contato não vê mais o Pix${auto ? ` (cobrança cancelada ${BUDGET_GRACE_MINUTES} min depois)` : ''}.`}>
          <select className={cn(campo, 'py-0')} value={validity} onChange={(e) => setValidity(e.target.value as BudgetValidity)}>
            {BUDGET_VALIDITY.map((v) => <option key={v} value={v}>{BUDGET_VALIDITY_LABEL[v]}</option>)}
          </select>
        </Field>
        <Field label="Observação (opcional)" hint="Vai no orçamento e na página do contato.">
          <input className={campo} placeholder="Ex.: entrega amanhã pela manhã" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      {porMensagem && modoItens === 'link' && validos.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-xl bg-accent-soft text-accent-ink px-3 py-2 text-xs">
          <Lock size={13} className="mt-px shrink-0" />
          <span>A empresa envia o orçamento só com número e total — os itens o cliente vê no link, que mostra o pagamento depois da aprovação.</span>
        </p>
      )}
      {porMensagem && modoItens === 'protect' && sensiveis.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-xl bg-accent-soft text-accent-ink px-3 py-2 text-xs">
          <Lock size={13} className="mt-px shrink-0" />
          <span>Itens sensíveis ({sensiveis.slice(0, 4).join(', ')}{sensiveis.length > 4 ? '…' : ''}): o orçamento vai pelo WhatsApp só com número e total — os itens o cliente vê no link, que mostra o pagamento depois da aprovação. Protege o número de bloqueio.</span>
        </p>
      )}

      {porMensagem && verPrevia && validos.length > 0 && (
        <pre className="rounded-xl bg-field p-3 text-xs text-ink whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">{previa}</pre>
      )}

      <div className="flex items-center justify-end gap-2 flex-wrap">
        {porMensagem && <button type="button" className="text-xs text-muted hover:text-ink mr-auto" onClick={() => setVerPrevia((v) => !v)}>{verPrevia ? 'Esconder prévia' : 'Ver prévia da mensagem'}</button>}
        {porMensagem ? (
          <>
            <Button variant="ghost" icon={<Link2 size={14} />} onClick={() => gerar(false)} disabled={criar.isPending || enviando} title="Sem orçamento por texto: itens e valores só na página do link">Só o link</Button>
            <Button icon={<Send size={14} />} onClick={() => gerar(true)} loading={criar.isPending || enviando} loadingText="Enviando…" title="O cliente aprova respondendo a forma de pagamento; no Pix, o link sai pelo atalho acima do campo">Enviar orçamento</Button>
          </>
        ) : (
          <Button icon={<Link2 size={14} />} onClick={() => gerar(false)} loading={criar.isPending} title="Itens, valores e desconto na página do link">Gerar link do orçamento</Button>
        )}
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

function ListaOrcamentos({ conversationId, budgets, carregando, onInserir, link }: { conversationId: string; budgets: Budget[]; carregando: boolean; onInserir: (b: Budget) => void; link: ReturnType<typeof useEnviarLink> }) {
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
            {b.number && <span className="text-xs text-muted tnum">Nº {b.number}</span>}
            <b className="tnum">{brl(b.totalValue)}</b>
            {b.awaitingApproval && b.status === 'PENDING'
              ? <span className="text-[11px] rounded-full px-2 py-0.5 bg-accent-soft text-accent-ink">Aguardando aprovação</span>
              : <span className={cn('text-[11px] rounded-full px-2 py-0.5', STATUS_CLS[b.status])}>{BUDGET_STATUS_LABEL[b.status]}</span>}
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
          <p className="text-xs text-muted truncate">{resumoItens(b)}</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {b.awaitingApproval && b.status === 'PENDING' && (
              <>
                <Button variant="success" size="sm" icon={<Link2 size={13} />} loading={link.enviando === b.id} onClick={() => link.enviar(b)}>Aprovado no Pix: enviar link</Button>
                <Button variant="ghost" size="sm" icon={<CreditCard size={13} />} loading={link.aprovandoSemLink === b.id} onClick={() => link.semLink(b)}>Aprovado em cartão/dinheiro</Button>
              </>
            )}
            {/* sem aprovação o link não vale: nada de copiar/inserir */}
            {!b.awaitingApproval && b.status === 'PENDING' && <Button variant="ghost" size="sm" icon={<CornerDownLeft size={13} />} onClick={() => onInserir(b)}>Inserir no campo</Button>}
            {!b.awaitingApproval && <Button variant="ghost" size="sm" icon={<Copy size={13} />} onClick={() => copiar(b.hash)}>Copiar link</Button>}
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
                onClick={() => { if (confirm(b.paidVia === 'asaas' ? 'Estornar? O Asaas devolve o dinheiro ao contato e a venda sai da meta.' : 'Registrar estorno? A venda sai da meta e do faturamento.')) estornar.mutateAsync({ conversationId, id: b.id }).then(() => toast.ok('Estorno registrado'), toast.err); }}>
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
