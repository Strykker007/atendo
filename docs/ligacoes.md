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

Botões: **Abrir conversa** (a ligação já cria a conversa quando o telefone é conhecido); sem
telefone, nenhum botão. Contato desconhecido aparece pelo telefone. Se o WhatsApp mandar só o `@lid` (sem
telefone) e ele não resolve — o contato nunca trocou mensagem com o número —, aparece
**"Contato novo · primeiro contato com este número"**.

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
  "Contato novo". Ligação em grupo é ignorada. Cada evento
  é registrado no log (`ligação <instância>: {...}`, 600 caracteres) até o formato estar
  confirmado em produção.
- **Fora do ledger:** ligação não é mensagem do WhatsApp — não passa pelo `UsageService`
  (não é cobrança), não dispara fluxo nem boas-vindas e não mexe em `lastInboundAt` (não abre
  a janela de 24h da Meta).

## Registro na conversa

Como no WhatsApp, cada ligação vira uma **linha no meio do chat** (`LinhaDeLigacao` em
`ChatPane.tsx`): "📞 Ligação de voz perdida · 14:32". É uma linha em `messages` com
`type = 'call'` (migration `20270130000000_message_type_call`, só um valor novo no enum),
`direction = 'in'`, `externalId = "call:<id da ligação>"` (prefixo para nunca colidir com id de
mensagem) e `content = { kind: 'call', isVideo, outcome }`. Regras em
`conversations/call-record.ts`; quem grava é `InboundService.registrarLigacao`.

| `outcome` | Quando | Linha |
|---|---|---|
| `ringing` | primeiro evento (`offer`/`ringing`) | "Ligação chamando…" (até 2 min; depois "recebida") |
| `answered` | `accept` | "Ligação de voz atendida no celular" |
| `missed` | `timeout` ou `terminate` sem atender | "Ligação de voz perdida" (vermelho) |
| `rejected` | `reject` | "Ligação de voz recusada" (vermelho) |

Desfecho final não muda mais (o `terminate` depois do `accept` não vira perdida). Eventos da
mesma ligação chegam em paralelo: o `@@unique([numberId, externalId])` garante uma linha só.

- **Contato novo:** contato e conversa nascem (conversa em Aguardando), como na primeira
  mensagem. Só com telefone: se o `@lid` não resolveu, fica só o aviso na tela.
- **Sobe na lista:** `lastMessageAt` e a prévia passam a ser a ligação (sem voltar o relógio
  se já houve mensagem depois).
- **Perdida ou recusada = mensagem nova:** +1 em não lidas, `awaitingSince` (cliente
  esperando) e conversa encerrada volta para a fila (`setStatusSystem → waiting`). Atendida
  no celular não mexe em não lidas nem no status.
- Sem "plim" de mensagem nova (o aviso já toca o alarme) e sem ações na linha (responder,
  reagir, encaminhar). Entra nas métricas que contam mensagens recebidas.
- **Compatibilidade:** a API anterior não conhece `call` no enum e falha ao ler essas
  linhas — migration e API nova sobem juntas.
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
