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
        queuedAt + prazo vencido            → falha "Não saiu: ficou mais de N min esperando a vez"
        há pendente anterior na conversa    → espera a vez (job atrasado 5 s; promovido antes)
        número não conectado                → pausa (job atrasado 60 s, sem chamar o provider)
   3. teto do dia — desligado (todo número com sendDailyLimit 0, sem aquecimento);
      se voltar a existir, vale só para envio proativo → falha sem retry
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
| `wa:cdone:<conversa>` | instante da última **entrega** na conversa — base do piso do Conteúdo (`minGapMs`) |

**A 1ª mensagem também espera.** Número ocioso (sem envio recente, `wa:next` no passado): o
envio sai depois de um sorteio do perfil (ex.: `moderate` 3–5 s), venha de fluxo, campanha,
resposta rápida, automação ou do atendente digitando — mensagem que sai no mesmo instante do
gatilho é padrão de robô. Em sequência, a espera é só o intervalo desde a entrega anterior (as
duas não somam). `instant` (Meta) continua sem espera; no `fast` (padrão da Evolution) a 1ª
mensagem leva 1–2 s.

**O intervalo conta da entrega, não da reserva.** Depois que o provider aceita a mensagem,
`SendPacer.delivered` empurra `wa:next` para *agora + novo sorteio do perfil* (ex.: `moderate`
3000–5000 ms) e `wa:cnext` para *agora + intervalo da conversa* (só para a frente). Antes, a
vaga era medida do horário reservado: num fluxo, as mensagens entram juntas e a 2ª só é
processada quando a 1ª termina (ordem por conversa) — se a 1ª era uma mídia que levou 6 s para
subir, a vaga da 2ª já tinha passado e ela saía colada. Vale para fluxo, campanha, boas-vindas,
lembrete e chat (todos passam pelo mesmo worker).

**Atraso do Conteúdo é piso.** O "esperar X s antes desta mensagem" do bloco Conteúdo (e das
boas-vindas/faixa) continua agendando o envio X s depois, e agora também vai no job
(`OutboundJob.minGapMs`): a mensagem só sai X s depois da **entrega** da anterior da conversa.
Com o ritmo do número, vale o **maior** dos dois (não somam): Conteúdo 2 s + `moderate` → 3–5 s;
Conteúdo 10 s + `moderate` → 10 s. O bloco **Esperar** (minutos/horas) segue como antes — é
muito maior que qualquer perfil.

O excedente **nunca é descartado**: o job espera a vaga. Quando é a rajada da conversa que
segura, o worker registra `warn` "Rajada na conversa …".

### Desconexão e reconexão (QR Code)
Número fora de `connected`: a fila dele para — nenhum job chama o provider; a vaga reservada é
descartada. Ao reconectar (webhook de conexão em `InboundService.numberConnectionChanged` ou
health check de 5 min), `resumeNumber` promove a cabeça de cada conversa do número, da mais
antiga para a mais nova; o ritmo do número espalha os envios. O que passou do prazo
(`maxQueueAgeMin`) **expira como falha** ("Não saiu: ficou mais de N min esperando a vez…") em vez de sair fora de contexto.

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

### Segurada pela proteção não expira

Mensagem que espera por **proteção do número** (aquecimento, teto de automáticas, ritmo) não é
fila parada: ela já aparece com ✓ e sai em segundo plano quando houver vaga. `holdForProtection`
(`send-queue.ts`) move `Message.queuedAt` para o horário em que ela deve sair, então o prazo de
*Expirar na fila após* conta dali; quem espera a vez atrás dela na conversa também é renovado.
Expira só o que está preso de verdade: número desconectado ou job perdido. **Teto de 6 h** desde a
criação (`PROTECTION_HOLD_MAX_MS`): depois disso volta o prazo normal, porque uma boas-vindas 6 h
depois já não faz sentido. Antes, no aquecimento, o fluxo acima do teto virava falha em 30 min.

### Na tela: ✓ na hora

Mensagem `pending` (na fila, esperando o ritmo do número, o aquecimento ou o "digitando…") já
aparece com **✓ cinza**, como se tivesse chegado ao servidor do WhatsApp. Antes aparecia o relógio
e o atendente achava que tinha travado — o atraso é proposital. **Só a tela muda**: a fila segue
igual; a mensagem vira ✓✓ quando o aparelho do contato recebe e, se não sair, vira falha (ícone
vermelho, motivo e *Tentar novamente*). `StatusIcon` em `ChatPane.tsx`.

### Respostas rápidas
Escolher uma resposta (painel da direita ou menu ⚡ do campo) agenda o envio: barra
"Enviando *Título* em Ns…" com **Cancelar** e **Editar** (Editar = comportamento antigo: vai
para o campo para revisar). Trocar de conversa cancela. Erro no envio devolve o texto ao campo.
Fora do modo de responder (nota interna, número desconectado, conversa encerrada…) a resposta
só entra no campo. Configuração: *Configurações → Respostas rápidas* (`TenantSettings.quickReplyDelaySec`).

### Envio frio

Mensagem para quem **não escreveu naquele número nas últimas 24 h** (a mesma janela da Meta,
somando todas as conversas do contato no número). É a causa nº 1 de banimento no não oficial,
então (`conversations/cold-send.ts`, `ConversationsService.assertColdAllowed`):

| Número | Contato escreveu < 24 h | Contato frio |
|---|---|---|
| **Evolution — atendente** | sai normal | até **10 contatos frios por dia** no número (`COLD_CONTACTS_PER_DAY`); acabou → 409 `cold_quota_exhausted`, com quando libera |
| **Evolution — automático** | sai normal | **recusa**: 409 `cold_send_unofficial`, com a explicação |
| **Meta** | sai normal | só template (regra da Meta) **e** o recurso `proactive_messaging` no plano (403 `feature_proactive`) — só para envio do atendente |

**Fluxo disparado à mão** conta como o atendente: `FlowEngineService.start` com `startedById` chama
`ConversationsService.assertFlowCanStart` antes de criar o run. Contato frio no QR gasta uma vaga
(sem vaga → 409 `cold_quota_exhausted` na tela); no oficial, 400 pedindo template. Conversa
encerrada, número desconectado e contato descadastrado também viram erro na hora — antes o run
nascia e falhava no 1º envio, e o atendente via só que "nada aconteceu". Com a vaga gasta, o
automático daquela conversa passa (`hasColdSlot`): as mensagens do fluxo e o que vier depois nas
24 h. Fluxo por gatilho continua recusado para contato frio.

**Vagas de contato frio** (Evolution): sorted set no Redis `wa:cold:<número>` com o contato e o
instante da 1ª mensagem, janela deslizante de 24 h, reserva atômica (Lua). Escrever de novo para o
mesmo contato dentro das 24 h não gasta outra vaga; a vaga volta 24 h depois de usada. Vale para
qualquer número QR, novo ou antigo — antes não havia vaga nenhuma e o cliente não conseguia nem
retomar um orçamento. `GET /conversations/cold-quota?numberId=` devolve `{ used, max, resetsAt }`
(`null` no oficial). A tela avisa antes do erro: *Nova conversa* mostra quantas restam, o chat mostra
uma faixa acima do campo quando o contato está frio, e *Números* lista todas as regras de proteção
do número QR (`components/numbers/ProtectionRules.tsx`).

Vale para responder no chat, encaminhar, agendadas, "Iniciar conversa" (checado **antes** de
criar/reabrir a conversa) e envio do sistema (fluxo que retoma dias depois, por exemplo).
**Exceção:** lembretes e aviso ao profissional da Agenda (`allowCold`) — o cliente pediu o
contato ao agendar, o texto é esperado e o volume é baixo. **Transmissão em massa** só inicia em
número oficial (é envio frio por definição). A tela *Nova conversa* explica a regra antes do erro.

### Envio automático

Mensagem sem autor humano (fluxo, boas-vindas, faixa, lembrete, campanha) no **não oficial**:

- espera um sorteio de **4–10 s** (`AUTO_GAP_MS`) desde o último envio do número, de qualquer
  origem (`wa:last`, atualizado na reserva e na entrega). Com o número ocioso, a 1ª também espera;
- teto de **automáticas por hora** no número (`autoPerHour`, padrão 80 Evolution / 5000 Meta,
  janela deslizante `wa:auto`). Estourou → o envio espera a vaga (log `warn`), nunca é descartado.

A resposta do atendente **não** espera nada disso — só o perfil do número. Texto de robô colado e
em volume é o padrão que o WhatsApp pune; conversa humana não.

### Aquecimento

Sessão nova (QR lido: `pending_qr → connected` grava `WhatsAppNumber.sessionStartedAt`) no
**não oficial** passa **7 dias** aquecendo (`whatsapp/number-warmup.ts`). Reinício de servidor ou
oscilação de rede não reabre o aquecimento.

| Desde o QR | Contatos **novos** por hora | Automáticas por hora | Piso entre envios do número |
|---|---|---|---|
| 0–24 h | 30 | 45 | 5 s (vale também para o atendente) |
| 24–48 h | 60 | 60 | — |
| 48–72 h | 90 | 70 | — |
| 72 h–7 dias | 120 | 80 (= padrão) | — |
| > 7 dias | livre | padrão da conexão (80) | — |

**Automáticas por hora**: vale o menor entre a fase e o configurado na conexão. A mensagem do robô
acima do teto espera a vaga em segundo plano, sem expirar (até 6 h); a resposta do atendente não entra nessa conta. Motivo: a Drog. Nova Farma foi restrita em
7 h com ~50 automáticas/h — saudação de fluxo em quase toda conversa — num número recém-pareado.

"Novo" = contato que ainda não recebeu nada do número **na última hora** (`wa:wconv`, janela
deslizante). Quem já está conversando passa direto; o contato que não coube espera a vaga
em segundo plano (o job volta para a fila; ver [Segurada pela proteção não expira](#segurada-pela-proteção-não-expira)). Motivo: a Drogaria Total caiu duas vezes no 1º dia com tráfego saudável, mas ~28
contatos/h logo após o QR. O card do número em **Números** mostra a fase e até quando vai.

Valores afrouxados em 10/2026 (antes: 20/30/8 s, 50/50, 80/60, 120/70): com eles um fluxo de
boas-vindas de 3 mensagens atendia ~10 clientes por hora na fase 1 e o resto expirava na fila.
A fase 1 continua perto dos números que derrubaram as duas farmácias — é o maior risco que sobra.

### Humanização

No não oficial, antes de entregar:
- **fica online** (`NumbersService.markOnline` → Evolution `/instance/setPresence available`) e
  volta a **offline ~45 s depois da última atividade** (envio ou "digitando"). A instância conecta
  offline (`alwaysOnline: false` → `markOnlineOnConnect: false`) e **o WhatsApp não exibe
  "digitando" de conta offline**: o `delay` acontecia, mas o contato não via nada. `alwaysOnline`
  resolveria deixando o número online 24 h — padrão de robô. Janela no Redis (`wa:online:<número>`),
  só a 1ª atividade chama a Evolution; o timer de cada processo manda offline se ninguém renovou.
  Efeito colateral: enquanto online, o celular da loja não toca notificação (como com o WhatsApp
  Web aberto);
- **marca como lida** a última mensagem recebida da conversa (uma vez por mensagem, `wa:read`;
  a Evolution v2 pede `remoteJid` + `fromMe` + `id`, resolvido como na edição, por causa do LID);
- mensagem **automática** sai no tempo de uma pessoa (`humanTiming`, `whatsapp/number-warmup.ts`):
  - **reação** antes de começar: 1,2–3 s + 10 ms por caractere da resposta (até +2 s), contada da
    última mensagem do contato. O job é adiado (não segura o worker) e marcado `reacted`; na 2ª
    mensagem seguida do fluxo a reação já passou e não soma;
  - **"digitando…"** pelo tempo de escrever o texto: 3,5–6 caracteres/s sorteado por mensagem,
    entre 1,5 e 10 s (`TYPING_MAX_MS`; `OutboundMessage.typingMs` → `delay` da Evolution, que segura
    o worker e atrasa a mensagem — daí o teto). Ex.: 40 caracteres ≈ 7–10 s. Mídia sem texto:
    "gravando…" de 2 s.
  A do atendente digitada no painel não ganha atraso: ele já digitou de verdade;
- envio do **atendente que ninguém digitou** ganha o mesmo **"digitando…" simulado** (sem a reação:
  ele já está na conversa), pelo tamanho do que não foi digitado — `simulateTypingChars`, gravado em
  `messages.raw` — na **velocidade daquele atendente** (`User.typingSpeed`, escolhida em *Equipe →
  Digitação*: Devagar 2–3,5, Normal 3,5–6, Rápido 6–9 caracteres/s; `TYPING_SPEEDS` no shared), com
  o mesmo teto de 10 s. O automático usa Normal:
  - **resposta rápida** (sai pela contagem) e **mídia pela prévia** (legenda): o painel manda o
    tamanho do texto;
  - **campo de texto**: o painel conta os caracteres digitados de verdade (`inputType` de inserção;
    colar/arrastar não conta) e manda só a diferença — resposta rápida inserida no campo e texto
    colado ganham "digitando", o digitado não. A assinatura `*Nome:*` não entra na conta;
  - **só mídia** (sem legenda): 1,5 s;
  - **encaminhar** e **agendada**: a API marca sozinha com o tamanho do texto;
  - áudio gravado no painel não ganha: a gravação já levou o tempo real;
- **atendente digitando** no painel → **"digitando…"** no WhatsApp do contato, com começo e fim
  (`useTypingPresence` → `POST /conversations/:id/typing {state}`):
  - `composing` ao começar, renovado a cada 2 s enquanto digita; `paused` com 3 s sem teclar, ao
    enviar, ao apagar o texto, ao sair do campo ou trocar de conversa;
  - a Evolution v2.3.7 não deixa o "digitando" aberto (`sendPresence` sempre fecha com `paused`
    depois do `delay`), então `NumbersService.setTyping` mantém **um laço por contato** mandando
    blocos de 5 s em sequência — sobrepor blocos faria o `paused` de um apagar o outro. Estado no
    Redis (`typing:until` com 4 s de validade, `typing:loop` como trava) por haver mais de uma
    instância da API; teto de 2 min. `paused` encerra na hora;
  - só número não oficial conectado e conversa aberta. Sem isto a resposta humana chegava do nada,
    sem o "digitando" que todo WhatsApp Web real mostra antes;
  - cada `sendPresence` faz a Evolution conferir o número (`whatsappNumber`), mas com cache local
    dela: contato que já conversou não gera consulta ao WhatsApp.

### Variações de texto

Em toda mensagem **automática** (`sendAsSystem`: fluxo, boas-vindas, faixa, lembrete) o trecho
`{Oi|Olá|Bom dia}` vira uma das opções, sorteada a cada envio (`conversations/spin.ts`). `{{nome}}`
(variável) e `{texto}` sem barra ficam intactos. O editor de fluxos mostra a dica ao lado do
"Inserir variável". Resposta rápida e mensagem do atendente saem como estão.

### Descadastro

"sair", "parar", "descadastrar", "remover", "stop" (mensagem só com a palavra) marcam
`Contact.optOutAt`. **"cancelar"** só conta quando não é resposta: com fluxo esperando resposta
ou agendamento futuro do contato, segue para o fluxo/agenda (sem isto, quem cancelava um horário
parava de receber lembretes). Descadastrado não entra em **nenhum** envio automático — campanha,
fluxo, boas-vindas, faixa, lembrete (`sendAsSystem` recusa com `contact_opted_out`) — e a
automação nem roda para as mensagens dele. O atendente continua respondendo. A ficha do contato
mostra o aviso e o botão "O contato pediu para voltar a receber" (`PATCH contacts/:id {resubscribe: true}`).

### Número sem WhatsApp

Antes do 1º envio a um contato num número (contato que nunca escreveu por ele), a Evolution
confere se o telefone tem WhatsApp (`POST /chat/whatsappNumbers`): "Iniciar conversa", lembrete
e aviso ao profissional da Agenda. Não tem → `Contact.waInvalidAt`, envio recusado
(`contact_no_whatsapp`) e aviso na ficha. Falha na consulta ou provider que não sabe (Meta) não
bloqueia. A marca some quando o contato escreve.

## Valores padrão

Centralizados em `packages/shared/src/send-limits.ts`.

| Limite | Evolution | Meta | Faixa aceita | Onde muda |
|---|---|---|---|---|
| Máximo por minuto (número) | 40 | 80 | 1–600 | Números → Proteção → Limites da fila |
| Intervalo mínimo na conversa | 1 s | 1 s | 0–60 s | idem |
| Rajada por conversa | 6 msgs / 30 s | 10 msgs / 30 s | 1–100 / 5–600 s | idem |
| Expirar na fila após | 30 min | 30 min | 1–1440 min | idem |
| Automáticas por hora (número) | 80 | 5000 | 1–5000 | idem |
| Espaçamento do automático | 4–10 s | — | — | `AUTO_GAP_MS` (shared) |
| Retry | 5 tentativas, base 3 s, ×2, jitter ±50%, teto 120 s | | — | `SEND_RETRY` (código) |
| Contagem da resposta rápida | 3 s | | 0–30 s | Configurações (por cliente) |
| Recheck fora da vez / desconectado | 5 s / 60 s | | — | `send-queue.ts` (código) |

`WhatsAppNumber.sendLimits` (JSON) guarda só o que a conexão sobrescreveu; vazio = padrão do
provider. O perfil de intervalo (`sendDelay`), o teto diário e o aquecimento continuam como
em [04 — Providers](04-providers-whatsapp.md#proteção-contra-bloqueio-e-banimento) e somam-se a estes.

**Quem ajusta**: só o dono do sistema (`super_admin`, ou "entrando como" o cliente). O cartão
*Proteção do número* (intervalo, limites da fila, custo da linha) não aparece para o cliente, e
`PATCH /numbers/:id` descarta `sendDelay`, `sendLimits`, `sendDailyLimit`, `endWarmup` e
`infraCostMonth` vindos de quem não é o dono — o cliente acelerando o ritmo queimava a própria linha.

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
