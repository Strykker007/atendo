# Agendamento de mensagens (chat)

O atendente escreve agora e a mensagem sai depois: "amanhã 9h te mando o orçamento". Não
confundir com o [Agendamento de horários](13-agendamento.md) (agenda de barbearia/clínica).

## Quem pode

Permissão `conversations.schedule_message` (*Agendar mensagens para o cliente*), no grupo
Atendimento do perfil de acesso. Não é feature de plano: é ligada por perfil, para poder ser
vendida em qualquer plano. No padrão os perfis **Administrador** e **Atendente** têm (as migrações
acrescentam nos não editados; o Atendente desde `agent_default_permissions`); Gerente ganha quando
alguém marcar. Sem ela: o
relógio some, o X de cancelar some e `POST`/`DELETE` dão 403. A faixa com a lista continua
visível para todos da conversa.

## Na tela

- **Relógio** na barra abaixo do campo (`ComposerBar`) → modal *Agendar mensagem*: o texto do
  campo já vem preenchido (editável, com "Inserir variável"), atalhos *Em 1 hora*, *Em 3
  horas*, *Amanhã 09:00*, *Amanhã 14:00* e campos de **Data** e **Hora** (horário do navegador
  de quem agenda). Agendou com o texto do campo → o campo é limpo.
- **Faixa retrátil** acima do campo (`ScheduledMessagesBar`): "2 mensagens agendadas · próxima
  amanhã às 09:00"; aberta, lista cada uma com horário, autor e **X** para cancelar. Aparece
  mesmo com o campo bloqueado (conversa encerrada ou de outra pessoa). As que **não saíram**
  ficam em vermelho com o motivo até alguém dispensar (X).
- Hoje o modal agenda **só texto**. A API já aceita anexo (`mediaKey`…), a tela ainda não.

## Regras

- Na criação: 1 minuto à frente no mínimo, até 365 dias; texto obrigatório (ou anexo).
- Conversa de **outra pessoa** → 409 (mesma regra do envio: ninguém fala pelo outro).
- Número **Meta**: só aceita horário dentro da janela de 24h a partir da última mensagem do
  cliente (fora dela só template, e template agendado não existe ainda) → 400 com o limite.
- Na hora do envio a mensagem passa por `ConversationsService.send` **em nome de quem
  agendou**: quota (`canSend`), janela da Meta, "responder = assumir", variáveis
  ([Variáveis](variaveis.md) — `{{saudacao}}` é a do horário do envio), fila única
  ([Envio](envio.md)) e `UsageService.record` (no worker de saída, como qualquer mensagem).
- Conversa **encerrada** na hora → é reaberta (`in_progress`) e a mensagem sai; quem agendou
  vira o responsável.
- Não deu para enviar → `failed` com `error` (aparece na faixa, em vermelho) **e** uma nota
  interna na conversa: "⏰ A mensagem agendada para 21/10 09:00 não foi enviada: <motivo>".
  Não há nova tentativa automática. Os motivos possíveis são as regras do envio do chat:

  | Situação na hora | Motivo mostrado |
  |---|---|
  | Número desconectado | O número "X" está desconectado. Conecte-o em Números para responder. |
  | Número removido/desativado | Esta conversa não tem um número de WhatsApp válido para responder. |
  | Meta, cliente sem falar há mais de 24h | Janela de 24h da Meta expirou. Envie um template aprovado. |
  | Limite de mensagens do plano atingido | o motivo do `UsageService.canSend` |
  | Outra pessoa assumiu a conversa depois do agendamento | Fulano está atendendo. Use uma nota interna ou transfira para você. |
  | Qualquer erro técnico (banco, fila…) | Erro inesperado no envio. Envie a mensagem manualmente. (o erro real vai para o log) |
- `idempotencyKey = scheduled-<id>`: job repetido não manda duas vezes.

## Modelo

`scheduled_messages` (`ScheduledMessage`): `tenantId`, `conversationId`, `contactId`, `userId`
(quem agendou = autor), `content`, `mediaKey/mediaType/mediaName/mediaMime`, `scheduledFor`,
`status` (`pending` | `sent` | `cancelled` | `failed`), `error`, `messageId`, `sentAt`,
`cancelledAt`, `cancelledById`. Migração `20261020000000_scheduled_messages`.

## Job

Fila BullMQ `scheduled-messages`, `upsertJobScheduler` a cada 60 s
(`ScheduledMessagesProcessor` → `ScheduledMessagesService.runDue`): pega até 100 `pending`
com `scheduledFor <= now()` (as demais ficam para o minuto seguinte), relê cada uma (pode ter
sido cancelada) e envia. Atraso máximo esperado: ~1 minuto + ritmo do número.

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/conversations/:id/scheduled-messages` | `pending` e `failed` da conversa, por `scheduledFor`, com `user {id, name}` |
| POST | `/conversations/:id/scheduled-messages` | `{content, scheduledFor (ISO), mediaKey?, mediaType?, mediaName?, mediaMime?}` |
| DELETE | `/conversations/:id/scheduled-messages/:scheduledId` | Cancela pendente / dispensa falhada. Já enviada → 404 |

Todas passam pelo `ConversationScopeGuard` (número/departamento do usuário). Socket
`scheduled_messages {conversationId}` a cada mudança → a faixa recarrega.

Código: `apps/api/src/modules/scheduled-messages/`, `apps/web/src/components/chat/ScheduledMessages.tsx`,
`apps/web/src/lib/hooks/agendadas.ts`.
