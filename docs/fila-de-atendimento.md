# Fila de atendimento (distribuição automática) e pausa

Funciona como uma URA: o contato chega, entra na fila, e **um robô decide quem atende**, por
igual, respeitando um limite de atendimentos por pessoa. Liberado para todas as empresas (não é
recurso de plano); começa desligado.

## Exemplo (limite 4 por pessoa)

Fila com 5 contatos. Vendedor 1 tem 4 abertos, vendedor 2 tem 2.

- vendedor 1 está no limite: não recebe enquanto não encerrar;
- vendedor 2 recebe 2 e chega a 4;
- os outros 3 ficam na fila — o painel mostra "3 na fila de espera";
- alguém encerrou: abriu vaga, o próximo da fila vai para ele na hora.

## Onde configura

**Configurações → Atendimento → Fila de atendimento** (`settings.manage`):

| Campo (`tenant_settings`) | Padrão | Para quê |
|---|---|---|
| `autoDistribute` | desligado | liga a distribuição automática |
| `autoDistributeMax` | 4 | atendimentos abertos por pessoa (1–50) |
| `autoDistributeLockClaim` | ligado | atendente não puxa da fila (ver abaixo) |

Migração `20270206000000_attendance_queue` (colunas com default + tabela `agent_pauses`).

## Regras

- **Na fila** = Aguardando, sem dono, sem robô rodando (`activeFlowRunId`), fora grupos e contatos
  isentos. Ordem de chegada: quem espera resposta há mais tempo (`awaitingSince`) primeiro.
- **Disponível** = painel aberto, dentro do turno (a mesma presença do Distribuidor) e **fora de
  pausa**, com acesso ao número e ao departamento da conversa e, se o número tiver lista, marcado em [quem recebe automaticamente](distribuicao-por-numero.md) (`autoReceiversOf`).
- **Limite** conta tudo que está com a pessoa e não foi encerrado (inclusive esperando o cliente),
  fora grupos e isentos.
- **Para quem vai**: entre os disponíveis abaixo do limite, o com **menos** atendimentos abertos;
  empate é **sorteado** (`pickQueueAgent`, `apps/api/src/modules/attendance-queue/queue-rules.ts`,
  testes em `test/queue-rules.test.ts`).
- Ninguém com vaga ou ninguém online: o contato fica na fila.

**Quando roda**: a cada 20 s (job `sweep` da fila `attendance-queue`) e na hora (job por cliente,
1 s, deduplicado) quando um contato entra em Aguardando sem dono, quando alguém encerra, e quando
alguém volta da pausa. A entrega só acontece se a conversa continua na fila
(`ConversationsService.distributeSystem`: Aguardando e sem dono) — quem assumiu no meio vence.

**Na entrega**: dono novo e Em atendimento; evento `transferred` sem ator com `reason` =
`distribuído pela fila`; nota interna "📥 Distribuído pela fila para Ana (3 de 4 atendimentos)";
alerta com som na tela de quem recebeu ("Fila de atendimento"). Nenhuma mensagem ao contato.

## Quem pode puxar

Com `autoDistributeLockClaim` (padrão), o **atendente** não tira contato da fila: o botão Assumir
vira "Na fila · distribuição automática" e a API recusa `POST /conversations/:id/claim` e responder
uma conversa sem dono (`assertQueueAllows`). Quem tem `conversations.transfer_any` (gerente/admin)
continua podendo assumir e transferir. Abrir conversa nova com um contato continua valendo (ela
já nasce com quem abriu).

## Junto com o resto

- **Bloco Distribuidor** (fluxos): com a fila ligada, em qualquer modo, só põe na fila (com o
  departamento do bloco) — quem escolhe é a fila. A lista de atendentes do bloco não vale.
- **Redistribuição automática** ([doc](redistribuicao-automatica.md)): continua, mas não entrega a
  quem já está no limite.

## Pausa

Qualquer pessoa da equipe marca **Disponível / Em pausa** no rodapé do menu lateral: motivo
(Almoço, Intervalo, Reunião, Outra atividade) e tempo (15 min, 30 min, 1 h ou até voltar). Em
pausa:

- não recebe atendimento da fila, do Distribuidor nem da redistribuição (sai do
  `availableUserIds`);
- continua com os atendimentos que já tem e responde normalmente;
- uma faixa amarela no topo de todas as telas lembra e tem "Voltar a atender";
- com prazo, volta sozinha quando vence (a rodada de 20 s fecha a pausa).

Vale com ou sem a fila ligada. Banco: `agent_pauses` (motivo, início, prazo, fim, quem encerrou) —
fica o histórico. Presença: HASH `presence:paused:<cliente>` no Redis (userId → prazo em ms; 0 = até
voltar), reescrito a partir do banco a cada rodada. Socket: `agent_pause` (abas da pessoa) e
`queue` (painel do cliente).

## Painel

- **Faixa da fila** no topo da lista de conversas (só com a fila ligada): "3 na fila de espera ·
  2 recebendo · você 2/4". Quem tem `conversations.view_all` abre e vê cada pessoa (recebendo, no
  limite, em pausa, fora) e pode tirar alguém da pausa.

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/queue/status` | `QueueStatus`: ligada, limite, trava, na fila, eu (abertos, pausa, online); `team` para quem vê todos |
| POST | `/queue/pause` | `{reason, minutes?}` (5–480; sem = até voltar) |
| POST | `/queue/resume` | volta da pausa |
| POST | `/queue/agents/:id/resume` | gerente tira alguém da pausa (`conversations.view_all`) |

## Ainda não

- limite por pessoa (hoje é um para a empresa);
- relatório de tempo em pausa (o histórico já está em `agent_pauses`);
- mensagem ao contato com a posição na fila.
