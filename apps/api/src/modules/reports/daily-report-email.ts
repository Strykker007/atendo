/**
 * Corpo do relatório diário por e-mail (docs/relatorio-diario.md). Puro (sem Nest/Prisma): recebe
 * os números já calculados pela visão geral e pelo ranking da tela de Relatórios, para o e-mail
 * nunca contar diferente do painel.
 */

export interface DailyReportKpis {
  conversations: number;
  closed: number;
  waitingNow: number;
  avgFirstResponseMin: number | null;
  won: number;
  lost: number;
  revenue: number;
  winRate: number | null;
}

export interface DailyReportAgent {
  position: number;
  name: string;
  closed: number;
  won: number;
  revenue: number;
  conversionRate: number;
  avgHandleMin: number | null;
  satisfaction: { avg: number | null; answered: number } | null;
}

export interface DailyReportInput {
  tenantName: string;
  /** "segunda-feira, 26/10/2026" */
  dayLabel: string;
  kpis: DailyReportKpis;
  ranking: DailyReportAgent[];
  /** motivos de perda mais frequentes do dia */
  lostReasons: { label: string; value: number }[];
  /** encerramento com venda (tenant_settings.salesEnabled): sem venda, some faturamento/conversão */
  salesEnabled: boolean;
  wonLabel: string;
  lostLabel: string;
  /** link "Abrir relatórios" */
  reportsUrl: string;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`);
/** "8 min", "1 h 05" */
export const minutos = (v: number | null) => {
  if (v === null) return '—';
  const m = Math.round(v);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function buildDailyReportEmail(r: DailyReportInput): { subject: string; text: string; html: string } {
  const k = r.kpis;
  const cards: [string, string][] = [
    ['Atendimentos iniciados', String(k.conversations)],
    ['Encerrados', String(k.closed)],
    ['Aguardando agora', String(k.waitingNow)],
    ['1ª resposta (média)', minutos(k.avgFirstResponseMin)],
    ...(r.salesEnabled
      ? ([[r.wonLabel, String(k.won)], ['Faturamento', brl(k.revenue)], ['Conversão', pct(k.winRate === null ? null : k.winRate * 100)], [r.lostLabel, String(k.lost)]] as [string, string][])
      : ([[r.wonLabel, String(k.won)], [r.lostLabel, String(k.lost)]] as [string, string][])),
  ];
  const head = ['#', 'Atendente', 'Atend.', ...(r.salesEnabled ? [r.wonLabel, 'Faturamento', 'Conversão'] : []), 'Tempo médio', 'Satisfação'];
  const linhas = r.ranking.map((a) => [
    `${a.position}º`, a.name, String(a.closed),
    ...(r.salesEnabled ? [String(a.won), brl(a.revenue), pct(a.conversionRate)] : []),
    minutos(a.avgHandleMin),
    a.satisfaction?.avg != null ? `${a.satisfaction.avg.toLocaleString('pt-BR')} (${a.satisfaction.answered})` : '—',
  ]);
  const subject = `Resumo de ${r.dayLabel.split(', ').pop()} — ${r.tenantName}`;

  const text = [
    `Resumo do atendimento de ${r.dayLabel} — ${r.tenantName}`,
    '',
    ...cards.map(([l, v]) => `${l}: ${v}`),
    '',
    'Ranking da equipe',
    ...(linhas.length ? linhas.map((l) => l.join(' · ')) : ['Nenhum atendimento encerrado no dia.']),
    ...(r.lostReasons.length ? ['', `Principais motivos de "${r.lostLabel}"`, ...r.lostReasons.map((m) => `${m.label}: ${m.value}`)] : []),
    '',
    `Abrir relatórios: ${r.reportsUrl}`,
    '',
    'Você recebe este e-mail porque marcou "Relatório diário por e-mail" em Configurações → Minha conta.',
  ].join('\n');

  const td = 'padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1e2433;max-width:640px;margin:0 auto;padding:24px">
<p style="margin:0;font-size:12px;color:#6b7280">${esc(r.tenantName)}</p>
<h2 style="font-size:18px;margin:4px 0 16px">Resumo de ${esc(r.dayLabel)}</h2>
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:6px">${chunk(cards, 4)
    .map((row) => `<tr>${row.map(([l, v]) => `<td style="background:#f4f6fb;border-radius:10px;padding:10px 12px;width:25%;vertical-align:top"><div style="font-size:11px;color:#6b7280">${esc(l)}</div><div style="font-size:18px;font-weight:600;margin-top:2px">${esc(v)}</div></td>`).join('')}</tr>`)
    .join('')}</table>
<h3 style="font-size:15px;margin:22px 0 8px">Ranking da equipe</h3>
${linhas.length
    ? `<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse"><thead><tr>${head.map((h) => `<th style="${td};text-align:left;font-size:11px;color:#6b7280;font-weight:600">${esc(h)}</th>`).join('')}</tr></thead><tbody>${linhas
        .map((l, i) => `<tr${i === 0 ? ' style="background:#fff8e6"' : ''}>${l.map((c, j) => `<td style="${td}${j === 1 ? ';font-weight:600' : ''}">${esc(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`
    : '<p style="font-size:13px;color:#6b7280">Nenhum atendimento encerrado no dia.</p>'}
${r.lostReasons.length
    ? `<h3 style="font-size:15px;margin:22px 0 8px">Principais motivos de "${esc(r.lostLabel)}"</h3><ul style="margin:0;padding-left:18px;font-size:13px">${r.lostReasons.map((m) => `<li>${esc(m.label)}: <b>${m.value}</b></li>`).join('')}</ul>`
    : ''}
<p style="margin:24px 0"><a href="${esc(r.reportsUrl)}" style="background:#2f5bea;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Abrir relatórios</a></p>
<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">
<p style="font-size:12px;color:#6b7280">Você recebe este e-mail porque marcou "Relatório diário por e-mail" em Configurações → Minha conta. Desmarque lá para parar.</p>
</div>`;
  return { subject, text, html };
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
