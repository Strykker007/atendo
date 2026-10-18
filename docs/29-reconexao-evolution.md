# 29 — Reconexão na Evolution 2.3.7: exclusividade e backoff (etapa 3)

Etapa 3 do [28](28-estabilizacao-conexao.md). Corrige os defeitos de conexão da auditoria
[24](24-auditoria-evolution.md) › 3.2 sem trocar versões: Evolution **2.3.7**, Baileys **7.0.0-rc.9**
(com o backport do [26](26-backport-cve-2026-48063.md)). **Status: implementado e testado localmente;
sem deploy.** Imagem `atendo/evolution-api:v2.3.7-atendo.3` (a `.2` é o rollback).

## O problema (medido)

Com o WhatsApp inacessível (DNS), a 2.3.7 reconecta **na hora** em todo fechamento recuperável:

- **~16–19 conexões por segundo**, até o event loop saturar;
- `createClient` trocava `this.client` sem encerrar o socket anterior, e os handlers do antigo
  continuavam vivos. O fechamento dele disparava outra reconexão, e dois sockets com as mesmas
  credenciais geravam `440 connectionReplaced`. Os dois reconectavam na hora, em ciclo;
- restart, `connect` da API e a reconexão automática podiam rodar ao mesmo tempo para a mesma
  instância.

## A correção

**Guarda de conexão:** `infra/evolution/atendo/connection-guard.cjs`. É legível, tem relógio e timers
injetáveis e é carregada no topo do bundle. No código minificado entram só pontos de chamada
(`patch-evolution-connection.mjs`, 8 trechos, cada um tem de aparecer **uma vez** em `main.js` e em
`main.mjs`, senão o build falha). A guarda não toca em credenciais nem chaves: só decide **quando**
chamar o connect original da Evolution.

| Regra | Como |
|---|---|
| Uma operação de conexão por instância | `connectToWhatsapp` e `reloadConnection` passam por `guard.connect`. Chamada durante outra recebe **a mesma promessa** (`connect.joined`). Com socket vivo (`ws.isOpen`/`isConnecting`), `connect` sem força devolve o atual. |
| Sem trava eterna | a operação tem prazo de 60 s: estourou, a trava e a vaga global soltam e a próxima tentativa segue |
| Geração de socket | antes de `this.client = makeWASocket(...)`, `retire` marca o socket atual como aposentado e o encerra (`ws.close` + `end`); depois, `adopt` numera o novo (`gen`) |
| Eventos de socket obsoleto | no início do `ev.process`, `filterStale` remove o `connection.update` vindo de socket aposentado ou substituído (`stale.dropped`). O resto do lote (mensagens) segue: nada se perde |
| Backoff com jitter | `onClose` no lugar do `await this.connectToWhatsapp()` imediato. **Um timer por instância** (agendar de novo substitui o anterior) |
| Limite global | no máximo 3 criações simultâneas e ≥ 200 ms entre inícios: tempestade quando todas caem juntas |
| Cancelamento | `logoutInstance`, remoção (`remove.instance`) e fechamento definitivo cancelam o timer pendente. O `connect` pelo painel/API reabilita |
| Restart | `patch-evolution-restart.mjs` agora chama `guard.restart`: força UM socket novo (para o zumbi), junta restarts simultâneos e ignora o restart logo depois de um socket recém-criado (< 5 s). O Atendo ainda limita a 1 por 2 min (`claimRestart`, doc 28) |

### Política por tipo de fechamento

| Fechamento | Espera | Observação |
|---|---|---|
| **408, 428, 500, 503**, DNS/rede, TLS, desconhecido | 1–2 s, 2–4, 4–8 … até **2,5–5 min** (exponencial, jitter de 50%) | A contagem só zera depois de ficar **aberto 1 min** (`stableMs`): conexão que oscila não volta ao 1º degrau |
| **515** restart required | 0,3–1 s, sem contar tentativa | É o reinício esperado logo depois de parear. Mais de 3 em 2 min vira backoff comum |
| **Ciclo do QR** (instância ainda sem pareamento que mostrou QR nesta conexão) | 1–2 s | Gera o próximo QR logo, até o limite `QRCODE_LIMIT` da Evolution |
| **440** connectionReplaced do socket **atual** | 30–60 s, 60–120, 120–240, 240–480 s; no **5º em 1 h, para** (`reconnect.parked`) | Os nossos sockets antigos já foram aposentados e o 440 deles é descartado. Então 440 do atual é **outra conexão** com as mesmas credenciais: outro container/servidor com a sessão (backup restaurado, deploy sobreposto) ou o próprio WhatsApp. Não disputamos indefinidamente. Conectar pelo painel reabilita |
| **401, 402, 403, 406** | não reconecta (como a 2.3.7) | A guarda só cancela timers pendentes. A Evolution limpa as credenciais por conta própria, como antes |

### Carimbo de ordem para o Atendo

O estado (`stateConnection`), que vai no webhook `connection.update`, ganha `atendoBoot`,
`atendoSeq` e `atendoGen`. São campos **a mais**, sem mudar os que existem.

- `atendoBoot`: `max(anterior + 1, segundos do relógio)`, gravado em `/evolution/instances/.atendo-boot`
  (volume das sessões; arquivo solto, a Evolution não varre esse diretório).
- `atendoSeq`: cresce a cada mudança de estado no processo.

O Atendo usa o carimbo para a ordem dos eventos. Isso substitui o atalho dos 35 min da etapa 2,
que foi removido (doc 28 › 2.5).

### Observabilidade

Uma linha JSON por evento no stdout da Evolution:

```json
{"atendo":"connection-guard","time":"…","evt":"reconnect.scheduled","instance":"…","gen":4,
 "attempt":4,"delayMs":15031,"code":408,"kind":"backoff",
 "message":"WebSocket Error (getaddrinfo ENOTFOUND web.whatsapp.com)","netCode":"ENOTFOUND"}
```

**Eventos:**

| Grupo | Eventos |
|---|---|
| Conexão | `connect.start`, `connect.joined`, `connect.skipped`, `connect.failed` |
| Socket | `socket.created`, `socket.retired`, `stale.dropped` |
| Reconexão | `reconnect.scheduled`, `reconnect.recovered` (com `attempts` e `downtimeMs`), `reconnect.parked`, `reconnect.cancelled` |
| Fechamento e restart | `close.definitive`, `close.ignored`, `restart.skipped` |

**Dados do erro:** só mensagem curta (até 160 caracteres), `statusCode`, `streamCode` e `netCode`.
Nada de credenciais, chaves ou tokens (há teste para isso).

```sh
docker logs atendo-prod-evolution-1 2>&1 | grep '"atendo":"connection-guard"' | grep -E 'parked|recovered|scheduled' | tail
```

## Medição — antes × depois (mesmas condições)

Container local, Postgres e Redis descartáveis, `web.whatsapp.com` sem DNS, instâncias recém-criadas,
120 s. Conta as criações de socket (linha `Baileys version` do log).

| Imagem | Instâncias | Conexões em 120 s | Por segundo | Por instância |
|---|---|---|---|---|
| `v2.3.7-atendo.2` (antes) | 1 | **1.982** | 16,5 | 1.982 |
| `v2.3.7-atendo.3` (depois) | 1 | **7** | 0,06 | 7 |
| `v2.3.7-atendo.2` (antes) | 10 | **1.934** (event loop saturado) | 16,1 | 193 |
| `v2.3.7-atendo.3` (depois) | 10 | **70** | 0,58 | 7 |

- **Intervalos de uma instância** (log real): 1,9 s → 3,7 → 5,9 → 15 → 30 → 50 → 126 s, até o teto
  de 2,5–5 min. Em 1 h de indisponibilidade são ~23 tentativas por instância (teste).
- **Espaçamento global:** o menor intervalo entre inícios de conexão foi de 199 ms (configurado 200).
- **Credenciais:** md5 de todas as linhas `Session` igual antes e depois da indisponibilidade, nas duas
  imagens.
- **TLS interceptado pelo ambiente** (certificado autoassinado, close 500): entra no mesmo backoff
  (10 → 18 → 32 → 85 s).
- **Remoção da instância:** `reconnect.cancelled why=remove` e **zero** sockets novos nos 30 s
  seguintes.
- **Webhooks reais** capturados: todo `connection.update` com carimbo. Passados pelo parser do Atendo
  na ordem, aplica os 7; invertidos, aplica só o mais novo.

## Testes

- `infra/evolution/test/connection-guard.test.mjs` (`node --test`, relógio falso): **20 testes**.
  Rodam também **dentro do build** da imagem. Cobrem:
  - conexões simultâneas (1 criação, mesma promessa);
  - `connect` da API com socket vivo;
  - dois restarts concorrentes, mais um terceiro logo depois;
  - reconexão agendada durante a criação;
  - socket antigo emitindo close atrasado;
  - 408 repetido (degraus exatos até 5 min);
  - 515 após parear (rápido) e 515 em excesso (backoff);
  - 440 externo (30 s → … → para no 5º; o painel reabilita);
  - 440 de socket nosso aposentado (descartado, não conta);
  - DNS fora por 1 h (≤ 30 tentativas);
  - WebSocket encerrado (428);
  - recuperação (log com tentativas e tempo fora; zera depois de 1 min estável);
  - oscilação (não zera);
  - cancelamento por logout, remoção e queda definitiva;
  - timer único;
  - `createClient` travado (trava solta em 60 s);
  - 50 instâncias caindo juntas (≤ 3 simultâneas, ≥ 200 ms entre criações, ninguém reconecta na
    hora);
  - carimbo monotônico mesmo com relógio atrasado;
  - log sem dados sensíveis.

  Credenciais intactas em todos os cenários: a guarda nunca chama logout nem remove credenciais.
- `infra/evolution/verify-patches.test.mjs` (build): os 21 anteriores, mais a guarda carregada no
  topo dos dois bundles, a contagem exata de cada ponto de chamada, a reconexão imediata ausente e a
  guarda definindo `globalThis.__atendoConn`. **Build limpo: 43 testes passando.**
- API: `test/connection-stability.test.ts` com a ordem revisada (carimbo, duplicata, boot anterior
  dentro e fora da janela, date_time estrito, parser do carimbo, Lua real com Redis). Suíte inteira:
  963 testes passando, mais 2 Lua (passam com `REDIS_TEST_URL`); `tsc` sem erros.
- Os patches anteriores (`<biz>`, CVE, gatilhos de placeholder) continuam aplicando e com seus
  testes no mesmo build.

**Não testado aqui (precisa de WhatsApp de verdade, fica para o piloto):** handshake e `open` reais,
515 real depois de ler o QR, 440 real e restart com o socket em `connecting`. O ambiente intercepta o
TLS e o socket fecha na hora, então a Evolution recusa o restart com `close`, como a 2.3.7 original.

## Riscos remanescentes

- **Recuperação mais lenta:** depois de uma queda longa, a volta pode esperar até 5 min (o
  degrau em que estava). O restart pelo painel força na hora.
- **440 parado no 5º em 1 h:** se for um caso legítimo e transitório do WhatsApp, o número fica fora
  até alguém conectar pelo painel (sem QR). Preferimos isso a duas sessões disputando.
- **Zumbi que diz `open`:** a guarda não o detecta sozinha; isso continua com a sonda (doc 28,
  aviso) e o restart (painel ou envio com "Connection Closed").
- **Patch no bundle minificado:** qualquer outra versão da Evolution quebra o build de propósito.
- **Carimbo:** se o volume `/evolution/instances` for perdido **e** o relógio estiver atrasado, por
  até 40 min os eventos podem ser tratados como atrasados. O health check corrige o status nesse
  meio-tempo.
- **Mensagens de socket aposentado:** só o `connection.update` é descartado; mensagens que ele ainda
  entregar seguem normalmente.

## Rollback

A imagem `v2.3.7-atendo.3` só vai a produção por `scripts/deploy-evolution.sh up` (doc 27), que
guarda a atual como `:previous`.

- **Rollback da imagem:** `bash scripts/deploy-evolution.sh <host> rollback`. Credenciais e chaves
  são as mesmas, sem QR.
- **Lado Atendo:** a ordem por carimbo é compatível com imagem antiga (sem carimbo cai no
  `date_time`). Para desfazer o código: `git revert` do commit e deploy comum.

## Piloto com número exclusivo de homologação

1. **Ambiente separado:** outro host ou outro compose project, com Postgres, Redis e webhook de
   homologação próprios. Nunca a sessão de um número de produção (duas sessões = 440).
2. **Chip só de teste**, sem clientes: build da `.3` (`docker compose --profile evolution build
   evolution`) e leitura do QR.
3. **Roteiro (1 dia), conferindo os logs `connection-guard` e os webhooks:**

   | # | Cenário | Esperado |
   |---|---|---|
   | a | Ler o QR | `515` → reconexão em < 1 s → `open` |
   | b | Bloquear a saída para o WhatsApp por 10 min (`iptables`, só no host de homologação) | degraus 1–2 s … até 5 min, sem rajada |
   | c | Liberar a saída | `reconnect.recovered` e mensagens voltando, sem QR |
   | d | Dois restarts seguidos pelo painel | 1 socket novo e 429 no segundo |
   | e | Abrir a mesma sessão em outro container (restaurar o backup do piloto noutro host) | 440 com espera crescente e `reconnect.parked`. **Desfazer logo:** é o cenário que o WhatsApp pune |
   | f | Logout pelo painel | `reconnect.cancelled` e nenhuma tentativa depois |

4. **Critérios para produção:**
   - zero QR pedido fora de 401/403;
   - zero rajada (mais de 1 conexão por segundo por instância);
   - zero `stale.dropped` seguido de 440;
   - envio e recebimento normais por 7 dias.
5. **Produção:** janela de madrugada, `deploy-evolution.sh build` e depois `up` (backup automático),
   com acompanhamento de `parked`/`recovered` na primeira hora.
