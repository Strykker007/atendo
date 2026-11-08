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
