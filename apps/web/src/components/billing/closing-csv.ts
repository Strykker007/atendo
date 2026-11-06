import type { ClosingMonth } from '@/lib/hooks';
import { csvNum, downloadCsv } from '@/lib/csv';

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
const SITU: Record<string, string> = { paid: 'Pago/recebido', open: 'Em aberto', overdue: 'Vencido' };
const ORIGEM: Record<string, string> = { asaas: 'Pix/Asaas', stripe: 'Cartão/Stripe', manual: 'Por fora', ativacao: 'Ativação' };
const SECAO: Record<string, string> = { revenue: 'Entradas', tax: 'Impostos', cost: 'Custos do serviço', expense: 'Despesas', payroll: 'Folha e encargos', prolabore: 'Pró-labore' };

/**
 * Relatório do mês do Fechamento numa planilha só (docs/36-fechamento-financeiro.md#baixar-o-relatório-do-mês):
 * resumo, parte dos sócios, mensalidades/cobranças e lançamentos — para o contador ou para arquivar.
 */
export function baixarRelatorioMes(d: ClosingMonth, nomeMes: string) {
  const s = d.summary;
  downloadCsv(`fechamento-${d.period}`, [
    {
      titulo: `Fechamento ${nomeMes}${d.closed ? ` — fechado em ${dia(d.closed.closedAt)}` : ' — em aberto (números podem mudar)'}`,
      head: ['Item', 'Valor'],
      linhas: [
        ['Recebido de clientes', csvNum(s.receivedClients)],
        ['Outras entradas', csvNum(s.otherIncome)],
        ['Impostos', csvNum(s.taxes ?? 0)],
        ['Custos do serviço', csvNum(s.costs ?? 0)],
        ['Despesas', csvNum(s.expenses)],
        ['Folha e encargos', csvNum(s.payroll)],
        ['Pró-labore', csvNum(s.prolabore)],
        ['Resultado', csvNum(s.result)],
        [`Reserva (${s.reservePercent}%)`, csvNum(s.reserve)],
        ['A distribuir', csvNum(s.distributable)],
        ['Contas do mês ainda não pagas', csvNum(s.unpaid ?? 0)],
        ['Previsto no mês', csvNum(d.expected)],
        ['Falta receber', csvNum(d.pending)],
        ['Caixa hoje', csvNum(d.cash.balance)],
      ],
    },
    {
      titulo: 'Parte dos sócios',
      head: ['Sócio', '%', 'Valor', 'Chave Pix', 'Pago em'],
      linhas: d.payouts.map((p) => [p.name, csvNum(p.percent), csvNum(p.amount), p.pixKey ?? '', dia(p.paidAt)]),
    },
    {
      titulo: 'Mensalidades e cobranças',
      head: ['Cliente', 'Origem', 'Vencimento', 'Valor', 'Situação', 'Pago em', 'Dias de atraso'],
      linhas: d.receivables.map((r) => [r.tenant, ORIGEM[r.origin] ?? r.origin, dia(r.dueDate), csvNum(r.amount), SITU[r.status] ?? r.status, dia(r.paidAt), r.daysLate > 0 ? String(r.daysLate) : '']),
    },
    {
      titulo: 'Lançamentos',
      head: ['Grupo', 'Categoria', 'Descrição', 'Fornecedor / cliente', 'Vencimento', 'Competência', 'Valor', 'Situação', 'Pago em', 'Forma', 'Nº documento', 'Observações'],
      linhas: d.entries.filter((e) => !e.skipped).map((e) => [SECAO[e.section] ?? e.section, e.categoryName, e.description, e.supplier ?? e.tenant ?? '', dia(e.date), e.period, csvNum(e.kind === 'expense' ? -e.amount : e.amount), SITU[e.status] ?? e.status, dia(e.paidAt), e.paymentMethod ?? '', e.documentNumber ?? '', e.notes ?? '']),
    },
  ]);
}
