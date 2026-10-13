'use client';
import { useState } from 'react';
import { BadgePercent, Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { usePromotions, useSavePromotion, useDeletePromotion, useApplyPromotionToAll, type PlanRow, type Promotion, type PromotionInput } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** "AAAA-MM-DD" no horário de Brasília (o input de data e a API falam assim). */
const diaSP = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const dataBR = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const meses = (n: number) => `${n} ${n === 1 ? 'mês' : 'meses'}`;

/** Situação da promoção agora: [rótulo, classe]. */
function situacao(p: Promotion): [string, string] {
  const agora = Date.now();
  if (!p.isActive) return ['Encerrada', 'bg-field text-muted'];
  if (new Date(p.endsAt).getTime() <= agora) return ['Terminou', 'bg-field text-muted'];
  if (new Date(p.startsAt).getTime() > agora) return ['Agendada', 'bg-warn-soft text-warn-ink'];
  return ['No ar', 'bg-ok-soft text-ok'];
}

type Form = PromotionInput & { id?: string };

/**
 * Promoções de entrada (só o dono): x% por N meses para quem assinar os planos escolhidos até
 * uma data. Ver docs/05-planos-e-cobranca.md#promoções.
 */
export function PromotionsSection({ plans }: { plans: PlanRow[] }) {
  const promos = usePromotions();
  const salvar = useSavePromotion();
  const apagar = useDeletePromotion();
  const [form, setForm] = useState<Form | null>(null);
  const [confirmar, setConfirmar] = useState<Promotion | null>(null);
  const aplicarTodos = useApplyPromotionToAll();
  const [paraTodos, setParaTodos] = useState<Promotion | null>(null);
  const [resultado, setResultado] = useState<{ promo: string; applied: number; skipped: { tenant: string; reason: string }[] } | null>(null);
  const pagos = plans.filter((p) => !p.isFree);
  const nome = (id: string) => plans.find((p) => p.id === id)?.name ?? 'plano removido';

  async function enviar() {
    if (!form) return;
    if (!form.planIds.length) return toast.err(new Error('Escolha ao menos um plano.'));
    try {
      await salvar.mutateAsync({ ...form, startsAt: form.startsAt || null });
      toast.ok(form.id ? 'Promoção atualizada' : 'Promoção criada');
      setForm(null);
    } catch (err) { toast.err(err); }
  }

  return (
    <section className="mt-8">
      <div className="flex items-center gap-2 mb-3">
        <BadgePercent size={18} className="text-accent" />
        <h2 className="font-display font-semibold text-ink">Promoções</h2>
        <span className="text-[12px] text-muted">Desconto por alguns meses para quem assinar até uma data.</span>
        <Button size="sm" className="ml-auto" icon={<Plus size={14} />} onClick={() => setForm({ name: '', discountPercent: 20, durationMonths: 3, planIds: [], startsAt: '', endsAt: diaSP(new Date(Date.now() + 30 * 86_400_000)) })}>Nova promoção</Button>
      </div>
      {promos.data?.length === 0 && <p className="text-sm text-muted rounded-2xl border border-dashed border-line px-4 py-6 text-center">Nenhuma promoção. Crie uma para dar desconto a quem assinar nas próximas semanas.</p>}
      {!!promos.data?.length && (
        <div className="rounded-2xl bg-panel border border-line divide-y divide-line">
          {promos.data.map((p) => {
            const [rotulo, cls] = situacao(p);
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{p.name}</span>
                    <span className={cn('text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md', cls)}>{rotulo}</span>
                  </div>
                  <div className="text-[12px] text-muted">
                    <b className="text-ink">{p.discountPercent.toLocaleString('pt-BR')}% off</b> por {meses(p.durationMonths)} · quem assinar de {dataBR(p.startsAt)} até {dataBR(p.endsAt)} · {p.planIds.map(nome).join(', ')}
                  </div>
                </div>
                <span className="text-[12px] text-muted tnum">{p.redemptions} {p.redemptions === 1 ? 'cliente' : 'clientes'}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setForm({ id: p.id, name: p.name, discountPercent: p.discountPercent, durationMonths: p.durationMonths, planIds: p.planIds, startsAt: diaSP(p.startsAt), endsAt: diaSP(p.endsAt), isActive: p.isActive })}>Editar</Button>
                  <Button size="sm" variant="ghost" icon={<UsersRound size={13} />} onClick={() => setParaTodos(p)} title="Aplicar a todos os clientes que assinam hoje os planos desta promoção">Aplicar a todos</Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setConfirmar(p)} title="Apagar promoção" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form && (
        <Modal open onClose={() => setForm(null)} title={form.id ? 'Editar promoção' : 'Nova promoção'}>
          <form onSubmit={(e) => { e.preventDefault(); void enviar(); }} className="space-y-4">
            <Field label="Nome" hint="Aparece para o cliente no plano e no seu controle."><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} required autoFocus placeholder="Black Friday" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Desconto (%)"><input className={inputCls} inputMode="decimal" value={String(form.discountPercent).replace('.', ',')} onChange={(e) => setForm({ ...form, discountPercent: Number(e.target.value.replace(',', '.')) || 0 })} required /></Field>
              <Field label="Por quantos meses" hint="Contados da assinatura de cada cliente."><input className={inputCls} type="number" min={1} max={60} value={form.durationMonths} onChange={(e) => setForm({ ...form, durationMonths: Number(e.target.value) || 1 })} required /></Field>
              <Field label="Começa em" hint="Vazio = agora."><input type="date" className={inputCls} value={form.startsAt ?? ''} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
              <Field label="Quem assinar até" hint="Inclusive, horário de Brasília."><input type="date" className={inputCls} value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} required /></Field>
            </div>
            <Field label="Planos" hint="Vale pelo checkout (Asaas) e para cliente criado por você em Novo cliente. Não acumula com valor já negociado.">
              <div className="rounded-lg border border-line divide-y divide-line">
                {pagos.map((p) => {
                  const marcado = form.planIds.includes(p.id);
                  const preco = Number(p.priceMonth);
                  return (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                      <input type="checkbox" checked={marcado} onChange={(e) => setForm({ ...form, planIds: e.target.checked ? [...form.planIds, p.id] : form.planIds.filter((x) => x !== p.id) })} />
                      <span className={cn(!p.isActive && 'text-muted')}>{p.name}{!p.isActive && ' (inativo)'}</span>
                      <span className="ml-auto text-[12px] text-faint tnum">{brl(preco)} → <b className="text-ink">{brl(Math.round(preco * (1 - form.discountPercent / 100) * 100) / 100)}</b>/mês</span>
                    </label>
                  );
                })}
              </div>
            </Field>
            {form.id && (
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> No ar (desmarque para encerrar antes da data)
              </label>
            )}
            {form.id && <p className="text-[12px] text-faint">Mudanças valem para quem assinar daqui para frente. Quem já ganhou mantém o desconto até o fim do prazo dele.</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
              <Button type="submit" loading={salvar.isPending} loadingText="Salvando…">Salvar</Button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        open={!!paraTodos}
        title="Aplicar a todos"
        text={`"${paraTodos?.name}" (${paraTodos?.discountPercent.toLocaleString('pt-BR')}% por ${paraTodos ? meses(paraTodos.durationMonths) : ''}) vai para todos os clientes que assinam hoje ${paraTodos?.planIds.map(nome).join(', ')}, a partir de hoje. Ficam de fora quem já tem personalização, quem já tem esta promoção e quem paga pelo Stripe. O valor novo vai para o Asaas nas próximas cobranças.`}
        confirmLabel="Aplicar"
        onClose={() => setParaTodos(null)}
        onConfirm={async () => {
          const p = paraTodos!;
          try {
            const r = await aplicarTodos.mutateAsync(p.id);
            toast.ok(`Promoção aplicada a ${r.applied} cliente(s)`);
            setResultado({ promo: p.name, ...r });
          } catch (err) { toast.err(err); }
          setParaTodos(null);
        }}
      />
      {resultado && (
        <Modal open onClose={() => setResultado(null)} title={`${resultado.promo} — resultado`}>
          <p className="text-sm text-ink mb-3">Aplicada a <b>{resultado.applied}</b> cliente(s).{resultado.skipped.length ? ` ${resultado.skipped.length} ficaram de fora:` : ''}</p>
          {!!resultado.skipped.length && (
            <ul className="rounded-lg border border-line divide-y divide-line text-[13px] max-h-80 overflow-y-auto">
              {resultado.skipped.map((x, i) => <li key={i} className="flex gap-2 px-3 py-1.5"><span className="text-ink">{x.tenant}</span><span className="ml-auto text-muted">{x.reason}</span></li>)}
            </ul>
          )}
          <p className="text-[12px] text-faint mt-3">Para incluir alguém que ficou de fora, use Clientes → Personalizar → Aplicar promoção.</p>
        </Modal>
      )}
      <ConfirmDialog
        open={!!confirmar}
        title="Apagar promoção"
        text={`"${confirmar?.name}" sai do ar. ${confirmar?.redemptions ? `Os ${confirmar.redemptions} cliente(s) que já ganharam mantêm o desconto até o fim do prazo.` : ''}`}
        confirmLabel="Apagar"
        danger
        onClose={() => setConfirmar(null)}
        onConfirm={async () => {
          try { await apagar.mutateAsync(confirmar!.id); toast.ok('Promoção apagada'); } catch (err) { toast.err(err); }
          setConfirmar(null);
        }}
      />
    </section>
  );
}
