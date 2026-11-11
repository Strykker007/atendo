# Redistribuição automática de conversas órfãs

Conversa em que o contato espera resposta há tempo demais **muda de mãos sozinha**: vai para o
atendente **online** com **menos atendimentos abertos**. Liberada para todas as empresas (não é
recurso de plano); começa desligada.

## Onde configura

**Configurações → Atendimento → Redistribuição automática** (`settings.manage`). Duas regras
independentes e três números:

| Campo (`tenant_settings`) | Padrão | Para quê |
|---|---|---|
| `autoReassignWaiting` | desligado | **Na fila sem ninguém assumir**: Aguardando, sem dono, contato sem resposta |
| `autoReassignAssigned` | desligado | **Com atendente, mas sem resposta**: quem assumiu não respondeu no tempo |
| `autoReassignBaseMinutes` | 15 | tempo com a fila tranquila (1–240) |
| `autoReassignMaxMinutes` | 30 | teto na alta demanda (1–480; menor que a base é salvo como a base) |
| `autoReassignMaxTimes` | 2 | quantas vezes a **mesma espera** pode ser redistribuída (1–10) |

Migração `20270203000000_auto_reassign` (só colunas com default).

## Tempo inteligente

A cada minuto, por empresa: **carga = contatos esperando resposta ÷ atendentes online**.

| Carga (por atendente online) | Tempo |
|---|---|
| até 1 | base |
| entre 1 e 4 | cresce em linha reta |
| 4 ou mais | teto (nunca passa dele) |

Exemplo com base 15 e teto 30: 1 → 15 min, 2 → 20, 3 → 25, 4+ → 30. Na correria todo mundo está
ocupado: tirar a conversa de alguém cedo só troca de fila, não atende mais rápido. Fórmula em
`reassignAfterMinutes` (`packages/shared/src/auto-reassign.ts`, a tela mostra a mesma conta).
**Ninguém online = nada acontece.**

## Quais conversas entram

- contato esperando resposta (`awaitingSince` preenchido — a primeira mensagem sem resposta);
- fora: encerradas, com robô rodando (`activeFlowRunId`), livres (isentas de ticket) e grupos;
- o relógio de **cada dono** começa no mais recente entre o início da espera e a última troca de
  mãos (assumiu, transferiu, devolveu): quem acabou de receber ganha o tempo inteiro.

## Para quem vai

- **online** = painel aberto, no turno e fora de [pausa](fila-de-atendimento.md#pausa) (a mesma presença do bloco Distribuidor);
- com a [fila de atendimento](fila-de-atendimento.md) ligada, quem está no limite de atendimentos não recebe;
- com acesso à conversa (número e departamento — mesma régua da transferência manual);
- se o número tem lista de [quem recebe automaticamente](distribuicao-por-numero.md), só quem está nela;
- fora quem está com ela e quem **já a recebeu nesta espera** (sem pingue-pongue);
- entre os que sobram, o com **menos conversas abertas** (empate: ordem fixa).

Depois de `autoReassignMaxTimes` redistribuições na mesma espera, a conversa fica onde está. Quando
a equipe responde, a espera acaba e a contagem zera.

## O que acontece na troca

- dono novo, status Em atendimento (`ConversationsService.reassignSystem`);
- evento `transferred` sem ator, `reason` = `redistribuído automaticamente` (entra no histórico e
  nos relatórios de transferência);
- **nota interna** na conversa: "🔁 Redistribuída automaticamente para Ana: Carlos não respondeu em
  16 min (limite agora: 15 min)";
- **alerta com som** na tela de quem recebeu ("Redistribuição automática");
- **nenhuma mensagem ao contato**.

A troca só acontece se a conversa continua como foi lida (mesmo dono, status e início da espera):
se alguém respondeu ou assumiu no meio do minuto, nada muda.

## Saiu do plantão

Terceira regra da mesma seção: **Devolver os atendimentos de quem saiu do plantão**
(`tenant_settings.releaseAwayEnabled`, desligada por padrão; `releaseAwayMinutes`, 30, entre 5 e 240).
Resolve o atendimento que ficava preso com quem já foi embora: o próximo plantão via a conversa com
outra pessoa e o contato ficava sem resposta.

| Como a pessoa saiu | Quando devolve |
|---|---|
| Clicou em **Sair** (menu) ou **Sair agora** / passagem expirou na [tela de fim de turno](escalas.md#fim-de-turno) | na hora (`POST /me/shift/handoff?auto=1`, que não faz nada com a regra desligada) |
| Fechou o painel, o computador desligou, o turno acabou (sessão travada sai da presença) | depois de `releaseAwayMinutes` fora |

- **Fora** = sem presença (painel aberto e no turno, a mesma do Distribuidor). **Pausa não conta
  como fora**: quem está em pausa segura os atendimentos.
- Só **atendente e gerente**: o admin da conta fica com os dele. Vale também para quem não tem escala
  (por isso o relógio é a presença, e não o fim do turno).
- Devolve para **Aguardando**, sem dono, com evento `released` sem ator (`reason` = `saiu do plantão`),
  nota interna "↩️ Devolvida para a fila automaticamente…" e **nenhuma mensagem ao contato**. Conversas
  livres (isentas de ticket) não entram. Se a pessoa voltou e respondeu, ou alguém assumiu, nada muda
  (`ConversationsService.releaseSystem` confere o dono antes de trocar).
- Relógio de cada pessoa no Redis (`presence:away:<tenant>`, userId → desde quando), no mesmo job de
  minuto da redistribuição (`AutoReassignService.runReleaseAway`; regra pura em
  `auto-reassign/release-away.ts`, testes em `test/release-away.test.ts`). Reinício rápido da API não
  devolve nada: o mínimo é 5 minutos.

## Código

| Peça | Onde |
|---|---|
| Regras puras (relógio, escolha do destino) | `apps/api/src/modules/auto-reassign/auto-reassign.ts` — testes em `test/auto-reassign.test.ts` |
| Rodada a cada minuto (fila `auto-reassign`, até 50 conversas por empresa) | `auto-reassign.module.ts` |
| Troca segura + destinatários | `ConversationsService.reassignSystem` / `receiversOf` |
| Tela | `apps/web/src/components/settings/AutoReassignSection.tsx` |

## Ainda não

- tempo por departamento (hoje a carga e os tempos são da empresa inteira);
- teto de conversas por atendente sem a fila ligada (com ela, vale o limite da fila).
