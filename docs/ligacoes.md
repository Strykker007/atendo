# Ligações no WhatsApp

Quando um cliente liga para um número conectado, o painel avisa em tempo real **quem está
ligando** e **para qual número**. A ligação é atendida no celular do número: o painel não
atende chamadas (ver [Atender pelo painel](#atender-pelo-painel)).

## O que o atendente vê

Um aviso fixo no canto superior direito, com alarme (respeita o som desligado):

| Situação | Aviso |
|---|---|
| Chamando (`offer`/`ringing`) | 📞 **Ligação no WhatsApp** (ou **Chamada de vídeo**) · nome do contato e telefone · "para **Loja Centro** · (11) 99999-0000" · "Atenda pelo celular deste número." Alarme repete a cada 5 s, por no máximo 1 min |
| Atendida no celular (`accept`) | o aviso some |
| Recusada, sem resposta ou desligada sem atender (`reject`/`timeout`/`terminate`) | vira **Ligação perdida** (vermelho) e fica até dispensar |
| 1 min tocando sem evento de fim | também vira **Ligação perdida** |

Botões: **Abrir conversa** quando o contato já tem conversa nesse número; senão **Copiar
número**. Contato desconhecido aparece pelo telefone. Se o WhatsApp mandar só o `@lid` (sem
telefone), aparece "Número oculto".

**Quem recebe:** só quem opera o número. A regra é a mesma da API (`number-scope.ts`): sem
números vinculados = todos; com vínculo (ou empresa/unidade selecionada) = só esses. O filtro é
no front, com o `numberIds` do `GET /auth/me`; o evento vai para a sala do tenant.

## Como funciona

```
WhatsApp → Evolution (evento call) → POST /webhooks/evolution → fila inbound
  → EvolutionProvider.parseCall → ParsedWebhook.calls
  → InboundService.applyCall (contato + conversa no número) → socket `call` (CallAlert)
  → front: receiveCall (filtra por número) → CallAlerts (components/layout/CallAlert.tsx)
```

- **Compose:** `WEBHOOK_EVENTS_CALL: "true"` na Evolution (principal e canário, em
  `infra/docker-compose.prod.yml`, e em `infra/docker-compose.yml`). Sem isso a Evolution nem
  manda o evento. Mudar o compose exige recriar o container da Evolution.
- **Payload** (`WACallEvent` do Baileys): `{ id, from, chatId, status, isVideo, isGroup, date }`,
  às vezes `callerPn`. O telefone sai do primeiro jid `@s.whatsapp.net` (o `:12` do aparelho é
  descartado). **Na prática vem só o `@lid`** (ex.: `{"from":"1201…@lid","chatId":"1201…@lid",
  "status":"ringing"}`, 03/11/2026): aí o `InboundProcessor` chama `phoneFromLid`, que busca
  na Evolution (`POST /chat/findMessages`, `where.key.remoteJid = @lid`, `limit 1`) uma mensagem
  desse contato — a Evolution guarda `remoteJid` = @lid e `remoteJidAlt` = telefone. Usa o índice
  `Message_instanceId_remoteJidJson_idx` (barato com milhões de linhas); cache de 1 h por
  instância + @lid, falha não entra no cache. Quem nunca trocou mensagem com o número fica
  "Número oculto". Ligação em grupo é ignorada. Cada evento
  é registrado no log (`ligação <instância>: {...}`, 600 caracteres) até o formato estar
  confirmado em produção.
- **Não é mensagem:** nada é gravado em `messages`, não passa pelo `UsageService` (não é
  cobrança) e não dispara fluxo nem boas-vindas. Quem não estava com o painel aberto não vê o
  aviso depois. Ligação perdida não fica registrada no histórico (possível evolução: um
  `ConversationEvent` novo, que exige migration).
- **Meta (oficial):** sem aviso hoje. A Cloud API manda ligação só pela Calling API, com outro
  webhook (`calls`), ainda não tratado.

## Atender pelo painel

- **Evolution (QR):** não dá. O Baileys recebe o aviso da chamada, mas não transmite o áudio
  (VoIP do WhatsApp). A Evolution só consegue recusar (`rejectCall`) e mandar uma mensagem
  automática (`msgCall`) — não ligados.
- **Meta (oficial):** possível com a **WhatsApp Business Calling API**: a ligação chega por
  webhook com SDP e o atendente fala pelo navegador (WebRTC). Exige número na Cloud API,
  habilitar chamadas no número, cobrança por minuto e uma tela de chamada com microfone.
  Entra no plano da migração para o oficial.
