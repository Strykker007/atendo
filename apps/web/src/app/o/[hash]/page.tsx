'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, ExternalLink, Upload, Clock, CircleCheck, CircleAlert, Loader2, Zap } from 'lucide-react';
import { BUDGET_RECEIPT_MAX_MB, BUDGET_RECEIPT_MIMES, PIX_KEY_TYPE_LABEL, budgetApprovalPhrase, type PublicBudget } from '@atendo/shared';
import { MarcaHorizontal } from '@/components/ui/Marca';
import { useBrand } from '@/lib/brand-context';

/**
 * Página pública do orçamento (docs/orcamentos.md) — o cliente abre pelo link do WhatsApp.
 * Sem login: o hash do link é a credencial. Mobile-first, sem nada do painel (nem `api()`,
 * que tenta renovar sessão e mandaria para o login).
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function fetchBudget(hash: string): Promise<PublicBudget> {
  const r = await fetch(`${API}/budgets/public/${encodeURIComponent(hash)}`);
  if (r.status === 404) throw new Error('Orçamento não encontrado. Confira o link ou peça um novo ao atendimento.');
  if (r.status === 429) throw new Error('Muitas tentativas. Aguarde um minuto e recarregue a página.');
  if (!r.ok) throw new Error('Não foi possível carregar o orçamento. Tente novamente em instantes.');
  return r.json();
}

export default function OrcamentoPublicoPage() {
  const { hash } = useParams<{ hash: string }>();
  const q = useQuery({
    queryKey: ['public-budget', hash],
    queryFn: () => fetchBudget(hash),
    retry: false,
    // Pix gerado e ainda pendente: confere a cada 5 s para mostrar "Pagamento confirmado" sozinho
    // Pix na tela: confere a baixa; esperando aprovação: a página vira pagamento quando o atendente libera
    refetchInterval: (query) => (query.state.data?.status !== 'PENDING' ? false : query.state.data.pixCharge ? 5000 : query.state.data.awaitingApproval ? 15000 : false),
    refetchOnWindowFocus: (query) => !!query.state.data?.pixCharge,
  });

  return (
    <main className="min-h-dvh bg-chat-bg text-ink">
      <div className="mx-auto w-full max-w-md px-4 py-6 space-y-4">
        {/* logo da empresa (Configurações → Páginas públicas); sem ela, a marca do painel */}
        <header className="flex justify-center py-2">{q.isLoading ? <div className="h-12" /> : q.data?.logoUrl ? <img src={q.data.logoUrl} alt={q.data.tenantName} className="h-12 max-w-[220px] object-contain" /> : <MarcaHorizontal className="h-8" />}</header>
        {q.isLoading && <Cartao><p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Carregando orçamento…</p></Cartao>}
        {q.error && <Cartao><p className="text-sm text-muted">{(q.error as Error).message}</p></Cartao>}
        {q.data && <Orcamento hash={hash} b={q.data} />}
      </div>
    </main>
  );
}

function Cartao({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-panel border border-line shadow-sm p-4 ${className}`}>{children}</section>;
}

function Orcamento({ hash, b: recebido }: { hash: string; b: PublicBudget }) {
  const brand = useBrand();
  const qc = useQueryClient();
  // relógio da página: no vencimento o Pix some na hora, sem esperar a próxima consulta ao servidor
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const venceu = recebido.status === 'PENDING' && agora >= new Date(recebido.expiresAt).getTime();
  useEffect(() => { if (venceu) void qc.invalidateQueries({ queryKey: ['public-budget', hash] }); }, [venceu]); // eslint-disable-line react-hooks/exhaustive-deps
  const b: PublicBudget = venceu ? { ...recebido, status: 'EXPIRED', pix: null, paymentUrl: null, pixCharge: null } : recebido;
  const validade = new Date(b.expiresAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <>
      <Cartao>
        <p className="text-xs text-muted">{b.tenantName || brand.brandName}</p>
        <h1 className="font-display text-lg font-semibold mt-0.5">
          {b.contactFirstName ? `Olá, ${b.contactFirstName}! ` : ''}Seu orçamento{b.number ? ` Nº ${b.number}` : ''}
        </h1>
        {b.agentName && <p className="text-xs text-faint mt-0.5">Preparado por {b.agentName}</p>}
        <Situacao b={b} validade={validade} agora={agora} />
      </Cartao>

      <Cartao className="p-0 overflow-hidden">
        <ul className="divide-y divide-line">
          {b.items.map((i, k) => (
            <li key={k} className="flex gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium break-words">{i.name}</p>
                {i.dosage && <p className="text-xs text-muted break-words">{i.dosage}</p>}
                <p className="text-xs text-faint tnum mt-0.5">{i.quantity} × {brl(i.unitPrice)}</p>
              </div>
              <p className="text-sm font-medium tnum shrink-0">{brl(i.quantity * i.unitPrice)}</p>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between px-4 py-3 bg-field">
          <span className="text-sm text-muted">Total</span>
          <span className="text-xl font-semibold tnum">{brl(b.totalValue)}</span>
        </div>
      </Cartao>

      {b.note && <Cartao><p className="text-xs text-muted mb-1">Observação</p><p className="text-sm whitespace-pre-wrap break-words">{b.note}</p></Cartao>}

      {b.awaitingApproval && b.status === 'PENDING' && b.number && (
        <Cartao className="text-center space-y-1">
          <p className="text-sm font-semibold">Gostou do orçamento?</p>
          <p className="text-sm text-muted">Para aprovar, responda no WhatsApp:</p>
          <p className="text-lg font-semibold tnum">{budgetApprovalPhrase(b.number)}</p>
          <p className="text-xs text-faint">Depois da aprovação, o pagamento aparece aqui nesta mesma página.</p>
        </Cartao>
      )}

      {b.status === 'PENDING' && b.autoPix && !b.awaitingApproval && <PixAutomatico b={b} />}

      {b.status === 'PENDING' && !b.autoPix && (b.pix || b.paymentUrl) && (
        <Cartao className="space-y-3">
          <h2 className="text-sm font-semibold">Pagamento</h2>
          {b.pix && <Pix pix={b.pix} />}
          {b.paymentUrl && (
            <a href={b.paymentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full rounded-xl bg-accent hover:bg-accent-hover text-white py-3 text-sm font-semibold">
              <ExternalLink size={16} /> Pagar agora
            </a>
          )}
        </Cartao>
      )}

      {/* Pix automático dá baixa sozinho: comprovante só para quem paga por chave/link */}
      {b.status !== 'EXPIRED' && b.status !== 'REFUNDED' && !b.autoPix && !b.awaitingApproval && <Comprovante hash={hash} enviado={b.receiptSent} />}

      <p className="text-center text-[11px] text-faint pt-2">Página segura de {b.tenantName || brand.brandName}. Não compartilhe este link.</p>
    </>
  );
}

function Situacao({ b, validade, agora }: { b: PublicBudget; validade: string; agora: number }) {
  if (b.status === 'PAID') return <Selo cls="bg-ok-soft text-ok" icone={<CircleCheck size={14} />}>Pagamento confirmado. Obrigado!</Selo>;
  if (b.status === 'REFUNDED') return <Selo cls="bg-field text-muted" icone={<CircleAlert size={14} />}>Pagamento estornado. Fale com o atendimento se tiver dúvida.</Selo>;
  if (b.status === 'EXPIRED') return <Selo cls="bg-field text-muted" icone={<CircleAlert size={14} />}>Este orçamento expirou em {validade}. Peça um novo ao atendimento.</Selo>;
  if (b.awaitingApproval) return <Selo cls="bg-accent-soft text-accent-ink" icone={<Clock size={14} />}>Aguardando sua aprovação · válido até {validade}</Selo>;
  // última hora: contagem regressiva — quem vai pagar no limite sabe que está no limite
  const faltam = Math.ceil((new Date(b.expiresAt).getTime() - agora) / 60_000);
  if (faltam <= 60) return <Selo cls="bg-warn-soft text-warn-ink" icone={<Clock size={14} />}>Vence às {new Date(b.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {faltam <= 1 ? 'menos de 1 minuto' : `faltam ${faltam} min`}. Pague antes disso.</Selo>;
  return <Selo cls="bg-warn-soft text-warn-ink" icone={<Clock size={14} />}>Válido até {validade}</Selo>;
}

function Selo({ cls, icone, children }: { cls: string; icone: React.ReactNode; children: React.ReactNode }) {
  return <p className={`mt-3 flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs ${cls}`}><span className="mt-px shrink-0">{icone}</span><span>{children}</span></p>;
}

/** Copiar com fallback: navegador embutido (WhatsApp, Instagram) às vezes não tem a clipboard API. */
function useCopiar() {
  const [copiado, setCopiado] = useState(false);
  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const t = document.createElement('textarea');
      t.value = texto;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }
  return { copiado, copiar };
}

/**
 * Pix automático: a cobrança já vem gerada (o atendente informou o CPF no orçamento). QR + copia
 * e cola com o valor exato; a página fica conferindo até o webhook dar baixa.
 */
function PixAutomatico({ b }: { b: PublicBudget }) {
  const { copiado, copiar } = useCopiar();
  if (!b.pixCharge) {
    return <Cartao><p className="text-sm text-muted">O Pix deste orçamento não está disponível. Fale com o atendimento.</p></Cartao>;
  }

  return (
    <Cartao className="space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-1.5"><Zap size={15} className="text-ok" /> Pix de {brl(b.totalValue)}</h2>
      {b.pixCharge.qrImage && (
        // QR para quem abriu no computador e paga pelo celular
        <img src={`data:image/png;base64,${b.pixCharge.qrImage}`} alt="QR Code do Pix" className="mx-auto w-52 h-52 rounded-lg bg-white p-2" />
      )}
      <p className="text-xs text-muted text-center">No celular: copie o código e cole em <b className="text-ink">Pix → Copia e cola</b> no app do seu banco.</p>
      <p className="font-mono text-[11px] break-all rounded-lg bg-field px-3 py-2 select-all max-h-24 overflow-y-auto">{b.pixCharge.payload}</p>
      <button type="button" onClick={() => copiar(b.pixCharge!.payload)} className="flex items-center justify-center gap-2 w-full rounded-xl bg-accent hover:bg-accent-hover text-white py-3 text-sm font-semibold">
        {copiado ? <><Check size={16} /> Código copiado</> : <><Copy size={16} /> Copiar código Pix</>}
      </button>
      <p className="flex items-center justify-center gap-1.5 text-xs text-muted"><Loader2 size={13} className="animate-spin" /> Aguardando o pagamento — esta página atualiza sozinha.</p>
    </Cartao>
  );
}

function Pix({ pix }: { pix: NonNullable<PublicBudget['pix']> }) {
  const { copiado, copiar: copiarTexto } = useCopiar();
  const copiar = () => copiarTexto(pix.key);
  return (
    <div className="rounded-xl border border-line p-3 space-y-2">
      <div className="text-xs text-muted">Pix · {PIX_KEY_TYPE_LABEL[pix.keyType] ?? pix.keyType}{pix.holderName && <> · {pix.holderName}</>}</div>
      <p className="font-mono text-sm break-all select-all">{pix.key}</p>
      <button type="button" onClick={copiar} className="flex items-center justify-center gap-2 w-full rounded-xl bg-accent hover:bg-accent-hover text-white py-3 text-sm font-semibold">
        {copiado ? <><Check size={16} /> Chave copiada</> : <><Copy size={16} /> Copiar chave Pix</>}
      </button>
    </div>
  );
}

function Comprovante({ hash, enviado }: { hash: string; enviado: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [estado, setEstado] = useState<'idle' | 'enviando' | 'ok'>('idle');
  const [erro, setErro] = useState('');

  async function enviar(f: File | undefined) {
    if (!f) return;
    setErro('');
    if (!(BUDGET_RECEIPT_MIMES as readonly string[]).includes(f.type)) return setErro('Envie uma foto (JPG, PNG, WEBP) ou um PDF.');
    if (f.size > BUDGET_RECEIPT_MAX_MB * 1024 * 1024) return setErro(`Arquivo maior que ${BUDGET_RECEIPT_MAX_MB} MB.`);
    setEstado('enviando');
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch(`${API}/budgets/public/${encodeURIComponent(hash)}/receipt`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? 'Não foi possível enviar. Tente novamente.');
      setEstado('ok');
      qc.invalidateQueries({ queryKey: ['public-budget', hash] });
    } catch (e) {
      setEstado('idle');
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      if (ref.current) ref.current.value = '';
    }
  }

  const pronto = estado === 'ok' || enviado;
  return (
    <Cartao className="space-y-2">
      <h2 className="text-sm font-semibold">Comprovante</h2>
      <p className="text-xs text-muted">
        {pronto ? 'Comprovante recebido — o atendimento já foi avisado. Se precisar, envie outro.' : 'Já pagou? Envie o comprovante por aqui — ele vai direto para o atendimento, sem passar pelo WhatsApp.'}
      </p>
      <input ref={ref} type="file" accept={BUDGET_RECEIPT_MIMES.join(',')} className="hidden" onChange={(e) => enviar(e.target.files?.[0])} />
      <button
        type="button"
        disabled={estado === 'enviando'}
        onClick={() => ref.current?.click()}
        className="flex items-center justify-center gap-2 w-full rounded-xl border border-line bg-panel hover:bg-field py-3 text-sm font-semibold disabled:opacity-60"
      >
        {estado === 'enviando' ? <><Loader2 size={16} className="animate-spin" /> Enviando…</> : pronto ? <><CircleCheck size={16} className="text-ok" /> Enviar outro comprovante</> : <><Upload size={16} /> Enviar comprovante</>}
      </button>
      {erro && <p className="text-xs text-danger">{erro}</p>}
    </Cartao>
  );
}
