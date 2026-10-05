# Envio — fila única, ordem, ritmo e retry

Tarefa 3. Objetivo: comportamento de envio saudável e previsível — sem rajada, duplicidade,
mensagem fora de ordem ou enxurrada depois de reconectar. Não é para "enganar" o WhatsApp.

## Como era antes (mapeamento)

- **Já havia fila única na prática.** Todo envio virava `Message` `pending` + job na fila
  BullMQ `wa-outbound` (`attempts: 3`, backoff exponencial 3 s): atendente
  (`ConversationsService.send`), encaminhar, reenviar, e o sistema por `sendAsSystem`
  (fluxos, boas-vindas/faixa de horário, Menu, agendamento pelo WhatsApp, lembretes via
  `sendToContact`/`sendToPhone`, campanhas). Só o `OutboundProcessor` chamava `provider.send`.
  Reação (`react`) e marcar como lido falam direto com o provider, mas não são mensagem.
- **Sem ordem por conversa.** Concorrência 20; dois itens do Conteúdo ou dois blocos seguidos
  podiam sair trocados (texto curto antes da imagem que ainda subia). O "1 s" padrão entre
  itens do Conteúdo era o remendo.
- **Ritmo só por número** (`SendPacer`): intervalo aleatório do perfil (`sendDelay`), teto do
  dia e aquecimento. Nada por conversa, nada por minuto.
- **Retry cego:** qualquer erro tentava 3 vezes (inclusive número inválido); providers lançavam
  `BadRequestException` sem status.
- **Número desconectado:** o envio novo era recusado na API, mas jobs já na fila tentavam o
  provider, falhavam e queimavam as tentativas.
- **Sem idempotência** além do `externalId` (que evita reenviar o que o provider já aceitou).

## Fluxo de envio agora

```
qualquer origem ──▶ ConversationsService.send / sendAsSystem
   valida (número da conversa, expectedNumberId, conexão, janela 24h, canSend)
   idempotencyKey repetida?  → devolve a mensagem existente (nada novo na fila)
   cria Message pending  (queueSeq = próximo da sequência, queuedAt = agora)
   enqueueOutbound()  jobId = out-<messageId>-<queueSeq>
                         │
                         ▼   OutboundProcessor (concorrência 20)
   1. não está pending / já tem externalId → nada / só corrige status
   2. planSend (puro, send-queue.ts):
        queuedAt + prazo vencido            → falha "Expirou na fila"
        há pendente anterior na conversa    → espera a vez (job atrasado 5 s; promovido antes)
        número não conectado                → pausa (job atrasado 60 s, sem chamar o provider)
   3. teto do dia (aquecimento) — só envio proativo (contato sem mensagem nas últimas 24h);
      resposta de atendimento pula esta etapa e não conta no contador → falha sem retry
   4. SendPacer.reserve (Lua atômico): perfil do número + máx/min do número
        + intervalo mínimo da conversa + rajada da conversa  → atrasa até a vaga
   5. provider.send
        ok          → sent, ledger (UsageService.record), promove a próxima da conversa
        permanente  → failed na hora (UnrecoverableError), promove a próxima
        transitório → retry com backoff exponencial + jitter; esgotou → failed
```

### Ordem por conversa
O BullMQ open source não tem grupos ordenados (é recurso do BullMQ Pro, pago), então a
ordem vem do banco, sem dependência nova: `Message.queueSeq` (BIGSERIAL) cresce a cada
mensagem; numa conversa só sai a pendente de **menor `queueSeq`** (a "cabeça"). Job fora da
vez volta atrasado e é **promovido** quando a da frente termina (enviada, falha ou expirada);
o recheck de 5 s é só rede de segurança. Conversas diferentes continuam em paralelo.

- Uma mensagem em retry segura as seguintes da mesma conversa — de propósito: sair a 2ª antes
  da 1ª é o que se quer evitar.
- Se a cabeça ficar presa (ex.: job perdido) além do prazo de expiração, o próximo job a expira.
- **Tentar novamente** dá `queueSeq` novo: a mensagem vai para o fim da fila da conversa.
- O intervalo do bloco Conteúdo continua valendo: ele é aplicado pelo motor **antes** de
  enfileirar, então soma-se ao ritmo da fila (o intervalo efetivo é pelo menos o maior dos
  dois). Não é mais necessário para garantir ordem.

### Ritmo
Uma reserva atômica no Redis cumpre ao mesmo tempo:

| Chave Redis | Limite |
|---|---|
| `wa:next:<número>` | intervalo aleatório do perfil do número (`sendDelay`, já existia) |
| `wa:rate:<número>` | máximo por minuto do número (janela deslizante de 60 s) |
| `wa:cnext:<conversa>` | intervalo mínimo entre mensagens seguidas da conversa |
| `wa:cburst:<conversa>` | rajada: N mensagens por janela na conversa |

O excedente **nunca é descartado**: o job espera a vaga. Quando é a rajada da conversa que
segura, o worker registra `warn` "Rajada na conversa …".

### Desconexão e reconexão (QR Code)
Número fora de `connected`: a fila dele para — nenhum job chama o provider; a vaga reservada é
descartada. Ao reconectar (webhook de conexão em `InboundService.numberConnectionChanged` ou
health check de 5 min), `resumeNumber` promove a cabeça de cada conversa do número, da mais
antiga para a mais nova; o ritmo do número espalha os envios. O que passou do prazo
(`maxQueueAgeMin`) **expira como falha** ("Expirou na fila…") em vez de sair fora de contexto.

### Deduplicação
- `Message.idempotencyKey` com unique `(conversationId, idempotencyKey)`. Repetir o mesmo
  envio devolve a mensagem existente (também na corrida: quem perde o unique devolve a outra).
- Chaves: tela do chat = `crypto.randomUUID()` por envio (texto, anexo, resposta rápida —
  criada na escolha, não no disparo); campanha = `campaign-<campanha>-<alvo>`; lembrete ao
  cliente = `reminder-<agendamento>-<minutos antes>`; aviso ao profissional = `pro-reminder-<agendamento>`.
- Fila: `jobId` determinístico (`out-<id>-<queueSeq>`) — enfileirar duas vezes não cria dois jobs.
- Retry do job: `externalId` gravado logo após o provider aceitar; job com `externalId` não reenvia.
- "Tentar novamente": troca de status condicional (`failed → pending`); clique duplo = 409.

### Retry
`isTransientSendError` (`providers/provider-error.ts`): transitório = rede/DNS/timeout,
HTTP 408/425/429/5xx, "Connection Closed" da Evolution, códigos de limite/indisponibilidade
da Meta (4, 80007, 130429, 131048, 131056, 1, 2, 131000, 131016, 133004), erro de infra
(storage). Permanente = demais 4xx (número inválido, mídia recusada, token) e validação local.
Providers lançam `ProviderSendError` (status HTTP + código da Meta; continua sendo 400 para quem
chama pela API).

Na tela, mensagem `failed` mostra o erro e **Tentar novamente**
(`POST /conversations/:id/messages/:messageId/resend`). Se a conversa mudou de canal desde a
falha, 409 `number_changed` — não reenvia pelo número antigo.

### Respostas rápidas
Escolher uma resposta (painel da direita ou menu ⚡ do campo) agenda o envio: barra
"Enviando *Título* em Ns…" com **Cancelar** e **Editar** (Editar = comportamento antigo: vai
para o campo para revisar). Trocar de conversa cancela. Erro no envio devolve o texto ao campo.
Fora do modo de responder (nota interna, número desconectado, conversa encerrada…) a resposta
só entra no campo. Configuração: *Configurações → Respostas rápidas* (`TenantSettings.quickReplyDelaySec`).

## Valores padrão

Centralizados em `packages/shared/src/send-limits.ts`.

| Limite | Evolution | Meta | Faixa aceita | Onde muda |
|---|---|---|---|---|
| Máximo por minuto (número) | 20 | 80 | 1–600 | Números → Proteção → Limites da fila |
| Intervalo mínimo na conversa | 2 s | 1 s | 0–60 s | idem |
| Rajada por conversa | 6 msgs / 30 s | 10 msgs / 30 s | 1–100 / 5–600 s | idem |
| Expirar na fila após | 30 min | 30 min | 1–1440 min | idem |
| Retry | 5 tentativas, base 3 s, ×2, jitter ±50%, teto 120 s | | — | `SEND_RETRY` (código) |
| Contagem da resposta rápida | 3 s | | 0–30 s | Configurações (por cliente) |
| Recheck fora da vez / desconectado | 5 s / 60 s | | — | `send-queue.ts` (código) |

`WhatsAppNumber.sendLimits` (JSON) guarda só o que a conexão sobrescreveu; vazio = padrão do
provider. O perfil de intervalo (`sendDelay`), o teto diário e o aquecimento continuam como
em [04 — Providers](04-providers-whatsapp.md#proteção-contra-bloqueio-e-banimento) e somam-se a estes.

## Arquivos

| Arquivo | Papel |
|---|---|
| `packages/shared/src/send-limits.ts` | Padrões, faixas, `resolveSendLimits`, `SEND_RETRY`, padrão da resposta rápida |
| `apps/api/src/modules/whatsapp/send-queue.ts` | `enqueueOutbound`, `requeueSeq`, `promoteNext`, `resumeNumber`, `planSend` (puro) |
| `apps/api/src/modules/whatsapp/outbound.processor.ts` | Worker: vez, pausa, expiração, ritmo, envio, retry |
| `apps/api/src/modules/whatsapp/send-pacer.ts` | Reserva atômica (Lua) número + conversa |
| `apps/api/src/modules/whatsapp/providers/provider-error.ts` | `ProviderSendError`, `isTransientSendError`, `retryDelayMs` |
| `apps/web/src/components/chat/QuickReplyCountdown.tsx` | Barra de contagem da resposta rápida |
| `apps/api/test/send-queue.test.ts` | Ordem sob concorrência, pausa/retomada, expiração, dedup, retry |

**Regra:** caminho novo de envio = gravar `Message` `pending` e chamar `enqueueOutbound`
(na prática, usar `ConversationsService.send`/`sendAsSystem`). Nunca chamar `provider.send` fora
do `OutboundProcessor`.
