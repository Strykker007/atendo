# Relatório diário por e-mail

Todo dia às **07:00 (Brasília)** quem marcou recebe o resumo do **dia anterior** do cliente:
atendimentos, tempo de resposta, vendas e o **ranking da equipe**.

## Quem recebe

- Funcionalidade de plano **`daily_report`** ("Relatório diário por e-mail"). O dono liga por plano
  em *Planos* (ou na personalização de um cliente). Cobrada à parte porque cada envio custa no
  provedor de e-mail. Em dev o seed liga em todos os planos; em produção quem escolhe são os donos.
- A própria pessoa marca em **Configurações → Minha conta → Relatório diário por e-mail**
  (`users.dailyReportEmail`, por vínculo: em multiempresa marca em cada empresa). Seção só aparece
  com a funcionalidade no plano e permissão `reports.view`.
- O relatório é do **cliente inteiro**, então só marca quem enxerga todos os números (sem números
  nem empresas vinculados). Restrito vê a seção desabilitada com o motivo. O dono "entrando como"
  não marca pelo cliente.
- Na hora do envio tudo é conferido de novo: plano com a funcionalidade e assinatura não
  suspensa/cancelada, usuário e cliente ativos, `reports.view` e escopo inteiro. Quem perdeu
  algum deles deixa de receber sem precisar desmarcar.
- E-mail: o do usuário, ou o do login principal no caso de vínculo.

**"Enviar um agora"** manda na hora, só para a própria pessoa, o relatório de ontem
(`POST /reports/daily-email/preview`).

## O que vem no e-mail

Mesmo cálculo da tela de Relatórios (`overviewData` e `rankingData` do `ReportsController`) —
o e-mail nunca conta diferente do painel. Período = ontem, de 00:00 a 00:00 no fuso do cliente
(`tenant_settings.timezone`).

| Bloco | Conteúdo |
|---|---|
| Indicadores | atendimentos iniciados, encerrados, aguardando agora, 1ª resposta média; com venda: Comprou, faturamento, conversão, Não comprou |
| Ranking da equipe | posição pela pontuação do ranking (pesos do cliente), atendimentos, vendas, faturamento, conversão, tempo médio, satisfação (média e respostas) |
| Motivos | os 3 motivos de "Não comprou" mais frequentes |

Cliente com **encerramento sem venda** (`salesEnabled = false`) não vê faturamento nem
conversão, e os nomes dos resultados são os dele (`wonLabel` / `lostLabel`).

## API

| Método | Rota | |
|---|---|---|
| GET | `/reports/daily-email` | `{ enabled, email, blockedReason }` |
| PUT | `/reports/daily-email` `{ enabled }` | exige a funcionalidade; 403 com o motivo se não puder |
| POST | `/reports/daily-email/preview` | envia agora para quem pediu |

## Envio

Fila `reports`, job agendado `daily-report-email` (`0 10 * * *` UTC), processado no worker
(`DailyReportService.sendAll`). Um cliente com erro não impede os outros; falha de envio de um
e-mail não impede os demais (log `falha ao enviar e-mail …`). Sem nova tentativa automática —
repetir o job mandaria em dobro para quem já recebeu. No fim, log
`relatório diário: N e-mail(s) para M cliente(s)`.

Código: `apps/api/src/modules/reports/reports.module.ts` (rotas, serviço, agendamento) e
`daily-report-email.ts` (corpo do e-mail). Migração `20270113000000_user_daily_report_email`
(coluna nova com padrão `false`, aditiva).
