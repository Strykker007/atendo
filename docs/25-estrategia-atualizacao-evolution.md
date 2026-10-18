# 25 — Estratégia de atualização da Evolution / Baileys e CVE-2026-48063 (18/10/2026)

**Status: proposta, aguardando autorização.** Nada foi alterado em produção, nenhuma dependência
foi atualizada e nenhuma instância foi reiniciada. Base: repositório
`evolution-foundation/evolution-api` (o antigo `EvolutionAPI/evolution-api` redireciona para ele;
refs idênticas), `WhiskeySockets/Baileys`, `WhiskeySockets/libsignal-node` e os pacotes npm
publicados, todos lidos em 18/10/2026. Complementa a [24 — Auditoria](24-auditoria-evolution.md).

---

## 1. Recomendação

**Alternativa A — manter a Evolution 2.3.7 e aplicar backports**, com as medidas compensatórias de D
enquanto o backport não vai para produção.

1. **Corrigir a CVE com backport de 2 commits do Baileys** (`3beb08e` + `5ddc231`, 46 linhas) no
   build da imagem, no mesmo modelo dos patches que já existem em `infra/evolution/`. Os dois
   trechos existem iguais no `lib/` compilado do rc.9, com os mesmos nomes de variável.
   **Backportar só o `3beb08e` quebra o sync de histórico e de chaves de app-state** — foi o que o
   rc13 corrigiu um dia depois do rc12.
2. **Fechar na Evolution os gatilhos por texto `requestPlaceholder` / `onDemandHistSync`**, que
   qualquer contato dispara hoje (é o caminho de pedido que a CVE explora no retorno).
3. **Não atualizar** para a 2.4.0-rc2, nem para o `develop` (seção 3).
4. Reavaliar quando houver uma 2.4.x **estável**, sem a regressão do 408, ou quando os
   P0/P1 da auditoria pedirem mais patches do que vale manter (seção 9).

Por quê: é a menor mudança que fecha a CVE, preserva as sessões (credenciais e chaves Signal ficam
no formato atual) e não traz o pacote de mudanças do `develop` (Prisma 7, Express 5, TypeScript 6,
cliente Redis 6, 121 commits de Baileys), que **mantém a regressão do 408** e **não corrige
nenhum** dos defeitos da auditoria 24.

---

## 2. Estado atual do upstream

### Evolution API

| Ref | Data | Baileys | Observação |
|---|---|---|---|
| **2.3.7** (produção) | 05/12/2025 | 7.0.0-rc.9 | última tag **estável** |
| 2.4.0-rc1 | 06/05/2026 | rc.9 | release candidate |
| **2.4.0-rc2** | 17/05/2026 | **rc.9** | release candidate; **continua vulnerável à CVE** |
| `main` | 06/05/2026 | rc.9 | atrás das RCs |
| **`develop`** | 14/07/2026 (último commit) | **rc13** | ninguém publicou nada há 3 meses |
| `chore/bump-baileys-7.0.0-rc10` | 06/05/2026 | rc10 | experimental, abandonado |

Não existe versão estável mais nova que a 2.3.7. **Alternativa B não existe hoje.**

### Baileys

| Versão | Data | CVE corrigida? |
|---|---|---|
| 7.0.0-rc.9 (nossa) | 21/11/2025 | não |
| rc10 / rc11 | 06/05 / 13/05/2026 | não |
| **rc12** | 20/05/2026 | sim, mas **quebra** o sync de histórico/app-state (`fromMe` errado em stanza do próprio aparelho) |
| **rc13** | 21/05/2026 | sim, com a correção do rc12 (`5ddc231`) |
| rc14 (`latest` no npm) | 29/07/2026 | sim. Desde o rc13: versão do WA Web, tc token da foto de perfil, navegador Android, CI |
| `master` | 04/08/2026 | `WIN32`→`WIN_HYBRID` (abaixo) |

O commit `0af2386` (pós-rc14) diz que, **desde ~30/06/2026**, o WhatsApp recusa o handshake com
`webSubPlatform = WIN32` (fecha com 428 antes do QR). **Não nos afeta:** o rc.9 só manda `WIN32`
com `syncFullHistory: true` **e** navegador `Desktop` (`lib/Utils/validate-connection.js:31-38`);
o nosso é `Windows / Chrome`, sem histórico completo → `WEB_BROWSER`. Só vira problema se alguém
ligar `syncFullHistory` com `Desktop`.

---

## 3. 2.3.7 × 2.4.0-rc2 × `develop`

`2.4.0-rc2` é ancestral do `develop`: 125 commits de 2.3.7→rc2, mais 19 até o `develop`.

### O que interessa à estabilidade

| Mudança | Onde entrou | Efeito para nós |
|---|---|---|
| **408 passou a "não reconectar"** → `logout.instance` → `cleaningUp` **apaga as credenciais** (QR obrigatório) | `72ca397` "fix: logout instance", 2.4.0-rc1 | ✅ **Regressão confirmada no código da rc1, da rc2 e do `develop`** (`develop: whatsapp.baileys.service.ts:505`). O PR #2612, que corrigiria isso, continua aberto. Cada timeout de rede viraria número desconectado pedindo QR, e re-parear é o que mais queremos evitar |
| Reconexão com `setTimeout(3000)` sem trava | rc1 | atraso fixo, mas sem impedir temporizadores concorrentes |
| 401 até 30 s depois de um 515 reconecta em vez de deslogar | `1d38d4f` (#2509), só no `develop` | trata a Issue #2498; útil, mas não conferimos nos nossos logs se o caso acontece (doc 24 › 8.1) |
| "Instância presa em `close`", limpeza de zumbi no logout, conclusão do history sync, cache da versão do WA Web, JIDs `@lid` | rc1/rc2 | correções reais, de baixo impacto para nós |
| **Auth bypass entre instâncias** (`?instanceName=` sobrescreve a instância autenticada; CWE-639, "CVE pending") | `7a55a2b`, só no `develop` | 2.3.7 **é afetada** (`abstract.router.ts:37-41`). **Exposição baixa:** em produção a porta 8080 da Evolution não é publicada (`expose`, sem rota no Caddy), e o Atendo usa a chave global |
| Baileys rc13: resiliência do app-state sync, reset de sessão quando a identidade do contato muda, mutex de transação do keystore, correções de pre-key | `develop` | provavelmente melhora "Invalid patch mac"/"Bad MAC" (Issue #2647). **Não está demonstrado** que resolve a sessão surda (Baileys#2491, ainda aberta) |
| **Prisma 6→7, Express 5, TypeScript 6, cliente Redis 6, axios** | `dd552c7` "atualização agressiva" (15/06) | grande superfície nova em banco, HTTP e Redis — justamente onde estão nossos incidentes |
| Build do `develop` quebrado de 15/06 a 13/07; o *gate* de CI "não rodava de fato" até `00f8f13` | `7db484e`, `00f8f13`, `7fde2fb` | o `develop` não tem histórico de estabilidade |
| Canal EvoHub (proxy da Meta Cloud) | `f742997` | não usamos |
| 2 migrações novas (`increase_token_length`, `add_runtime_config`) | rc2 | só para frente; voltar para a 2.3.7 depois de migrar exige restaurar o banco |

### Defeitos da auditoria 24 nas três versões

| Defeito (doc 24) | 2.3.7 | rc2 | develop |
|---|---|---|---|
| `createClient` não encerra o socket anterior (sessões duplicadas) | sim | sim | sim |
| Webhook de edição com `await` dentro da fila serial | sim | sim | sim |
| `try` único no `messages.upsert` (falha de banco perde o lote) | sim | sim | sim |
| Gatilhos `requestPlaceholder`/`onDemandHistSync` por texto de qualquer contato | sim | sim | sim |
| `.env.example` embutido liga eventos que não usamos | sim | sim | sim |
| Chaves Signal no Redis compartilhado | config nossa | idem | idem |

**Atualizar não corrige nenhum.** Os patches P0/P1 precisam ser feitos em qualquer cenário.

---

## 4. CVE-2026-48063 (GHSA-qvv5-jq5g-4cgg)

- **O quê:** um payload malicioso via `placeholderResendMessage` faz a sessão emitir um
  `messages.upsert` falso (chave e conteúdo forjados). O mesmo vetor corrompe o app-state sync com
  *key shares* falsos e falsifica o history sync.
- **Quem pode enviar:** o advisory diz "any baileys session" e não exige contato salvo nem conversa
  aberta. Tratamos como **qualquer conta do WhatsApp** que consiga mandar mensagem ao número.
- **Afetado:** `<7.0.0-rc12` e `<6.7.22`. O advisory nomeia `@whiskeysockets/baileys`; a Evolution
  usa o pacote `baileys` (sem escopo), que é o mesmo projeto, com as mesmas versões. **rc.9 afetada.**
- **Severidade:** *Critical* no GitHub. Bases que replicam o NVD dão CVSS 4.0 = 9,3; a página do
  GitHub não mostra o vetor.
- **Impacto para nós:**
  - mensagem forjada gravada na Evolution e entregue ao Atendo pelo webhook. Pode aparecer como do
    contato ou como `fromMe`, ou seja, "enviada pelo celular do cliente";
  - histórico falso no banco da Evolution, que o painel lê em `fetchHistory`;
  - chaves de app-state corrompidas: mesmo sintoma de "Invalid patch mac" da Issue #2647, sem
    contorno.
- **Correção upstream:** `3beb08e`, em `processMessage`: descarta HISTORY_SYNC_NOTIFICATION,
  APP_STATE_SYNC_KEY_SHARE, LID_MIGRATION_MAPPING_SYNC e PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE
  quando `!key.fromMe`. Complemento obrigatório `5ddc231`, em `decodeMessageNode`: marca `fromMe` na
  stanza que vem do próprio aparelho sem `recipient`. Sem ele, o histórico do QR e as chaves de
  app-state legítimas também são descartadas.
- **Contornos do advisory:** descartar `upsert` com `requestId`, ou
  `shouldSyncHistoryMessage: () => false`. O segundo **desliga o lote de histórico do QR**, de que
  dependem o histórico no painel e a agenda. Não há contorno para o app-state.

### Formas de corrigir

| Forma | Risco | Esforço | Sessões |
|---|---|---|---|
| **Backport `3beb08e`+`5ddc231` no `lib/` do rc.9** (patch de build) | baixo: 46 linhas, só caminhos de `protocolMessage` | baixo | intactas (mesmo keystore) |
| Trocar o Baileys da 2.3.7 por rc13/rc14 (sobrescrever dependência) | **alto**: a 2.3.7 foi compilada contra a API do rc.9. Entram 121 commits, `whatsapp-rust-bridge` (WASM, mantenedor único, no caminho de cripto do app-state) e `libsignal` via npm. A própria Evolution precisou de patch para isso (branch rc10) | médio | formato compatível (seção 6), mas comportamento novo |
| Build do `develop` | **alto** (seção 3) e com o 408 | alto | idem + migrações |
| Só o contorno do advisory | médio: perde funcionalidade e não protege o app-state | baixo | intactas |

---

## 5. Patches do Atendo diante de uma atualização

| Patch | Na 2.3.7 | No `develop`/rc13+ |
|---|---|---|
| `patch-baileys-biz.mjs` (nó `<biz>`) | necessário | **continua necessário**: o rc13 também não manda `<biz>`. A âncora `if (additionalNodes && additionalNodes.length > 0) {` existe igual no `lib/Socket/messages-send.js` do rc13 → aplica |
| `patch-evolution-restart.mjs` | necessário (P1 o substitui) | **continua necessário**: `restartInstance` está igual no `develop` (`instance.controller.ts:382-384`). A âncora é o `dist/main.js` **minificado**: qualquer rebuild muda os nomes, então o build falha de propósito e o patch precisa ser reescrito |
| **Novo** `patch-baileys-cve-2026-48063.mjs` | a criar | desnecessário (já incluído) |
| **Novo** gatilhos de texto só com `fromMe` | a criar | também necessário |
| Índices `Message` (doc 23/04) | no volume | conferir se o Prisma 7 / as migrações não os derrubam |

---

## 6. Matriz de riscos e compatibilidade

| Área | A. 2.3.7 + backports | C. build do `develop` (rc13) |
|---|---|---|
| **Credenciais (`Session.creds`, Postgres)** | sem mudança | formato **igual** (`AuthenticationCreds` idêntico no rc.9 e no rc13) |
| **Chaves Signal (Redis)** | sem mudança | aditivo: tipo novo `identity-key` e campo `senderTimestamp` no `tctoken`. Contato sem `identity-key` salva é aceito sem resetar a sessão (`saveIdentity`: TOFU, `src/Signal/libsignal.ts:490-512`) → **o upgrade não reinicia as sessões em massa**. `libsignal` 2.0.1 (git `1c30d7d`) → 6.0.0: **nenhuma linha de código mudou**, só o empacotamento e o protobufjs → formato da sessão igual |
| Volta para trás (rollback) | trivial (imagem anterior) | o rc.9 ignora `identity-key` (deve funcionar), **mas as migrações da 2.4 são só para frente**: voltar exige restaurar o `evolution-db` + chaves no Redis do mesmo instante. A Evolution precisa estar parada, e o que chegou nesse meio-tempo se perde |
| PostgreSQL da Evolution | igual | Prisma 7 + 2 migrações; os índices criados à mão (doc 23) precisam ser conferidos |
| Redis | igual | cliente Redis 6 (major), chaves e prefixos a conferir |
| Endpoints REST usados pelo Atendo (`instance/*`, `message/send*`, `chat/findMessages`, `getBase64FromMediaMessage`, `whatsappNumbers`, `sendPresence`, `updateMessage`…) | iguais | Express 5 muda o roteamento e o parsing; precisa do teste de contrato da seção 7 |
| Webhooks (formato, `apikey` no corpo, eventos) | iguais | sem mudança vista no `webhook.controller`; conferir pelo teste de contrato |
| Reconexão | igual (defeitos conhecidos) | **408 apaga credenciais** + `setTimeout` sem trava |
| Patches nossos | aplicam | `<biz>` aplica; restart precisa ser reescrito |
| Segurança | CVE fechada pelo backport; auth bypass `7a55a2b` mitigado pela rede (opcionalmente backportável) | as duas fechadas |
| Superfície nova | ~50 linhas | 144 commits Evolution + 121 Baileys + majors de dependência |

---

## 7. Testes automatizados (antes de qualquer imagem nova)

1. **Teste de build dos patches** (`infra/evolution/`): o build já falha se a âncora não for
   achada. Acrescentar, depois do patch, um script no próprio Dockerfile que importa os módulos
   alterados (`node -e "import('baileys')"`) e confere os marcadores dos patches. Imagem que não
   carrega não é publicada.
2. **Teste unitário da CVE** contra o `lib/` patcheado, sem WhatsApp, chamando o `processMessage`
   exportado do Baileys:
   - `protocolMessage` APP_STATE_SYNC_KEY_SHARE, HISTORY_SYNC_NOTIFICATION, PDO_RESPONSE e
     LID_MIGRATION com `fromMe: false` → descartado, sem evento e sem escrita no keystore;
   - os mesmos com `fromMe: true` → processados;
   - REVOKE e MESSAGE_EDIT de terceiros → continuam processados;
   - `decodeMessageNode` com `from` = nosso JID e sem `recipient` → `fromMe: true`; de terceiro →
     `fromMe: false`.
3. **Teste dos gatilhos de texto:** `conversation: "requestPlaceholder"`/`"onDemandHistSync"` de um
   contato → nenhuma chamada a `requestPlaceholderResend`/`fetchMessageHistory`.
4. **Contrato com o Atendo** (vitest, já é o runner da API): para cada endpoint da seção 6, uma
   gravação de request/response da 2.3.7 atual. Os fixtures dos webhooks
   (`messages.upsert`, `messages.update`, `messages.edited`, `connection.update`, `contacts.*`,
   `qrcode.updated`, `presence.update`) passam pelo `parseWebhook` — as suítes
   `evolution.provider.test.ts`, `evolution-from-me.test.ts` e `evolution-history.test.ts` já
   existentes são a base. Uma versão candidata só passa se reproduzir as mesmas respostas.
5. **Teste de sessão (homologação):** subir a imagem nova com cópia do `evolution-db` + chaves no
   Redis de **um número de teste**, sem tocar em produção. Conferir: reconecta sem QR, decifra
   mensagem de contato antigo e novo, envia, recebe, mídia, edição, apagar, histórico.

## 8. Piloto isolado

1. **Ambiente separado:** outro host ou outro compose project, com seu próprio `evolution-db`, Redis
   e webhook apontando para uma API de homologação. Nunca o mesmo Redis/DB de produção, e nunca o
   mesmo número conectado nos dois lados (duas sessões = `440`, doc 24).
2. **Números:** 1–2 chips de teste nossos, pareados do zero na imagem nova. Depois, 1 número real de
   cliente que aceite, **migrado com a sessão** (cópia de `creds` + hash Redis da instância, com a
   instância de produção **removida antes** de subir a nova).
3. **Duração:** 7 dias. Critérios para seguir:
   - zero QR pedido sem queda 401/403;
   - zero `Message ignored with messageStubParameters` a mais que o número de controle;
   - entrega e leitura confirmadas na mesma proporção;
   - nenhuma falha do teste de contrato.
4. **Produção:** em janela de madrugada, com backup do `evolution-db` **e** do Redis (`BGSAVE` +
   cópia do `dump.rdb`/AOF) imediatamente antes. Rollback = imagem anterior + esses dois backups.

---

## 9. Comparação das alternativas

| | A. 2.3.7 + backports | B. estável mais nova | C. build do `develop` | D. manter + compensar |
|---|---|---|---|---|
| Fecha a CVE | **sim** | — (não existe) | sim | parcial (contorno desliga o histórico do QR; app-state sem proteção) |
| Preserva sessões | **sim, sem migração** | — | provável, com migração só para frente | sim |
| Regressão do 408 | não tem | — | **tem** | não tem |
| Corrige defeitos da auditoria | não (P0/P1 à parte) | — | não | não |
| Superfície de mudança | ~50 linhas | — | centenas de commits + majors | zero |
| Rollback | trivial | — | caro | — |
| Manutenção | patches por âncora (já é o modelo) | — | acompanhar um branch sem release | — |

**D** serve só como ponte até o backport ir ao ar: bloquear na Evolution a porta 8080 (já está),
não ligar `syncFullHistory` e monitorar no log `dropping`/`Invalid patch mac`.

**Gatilhos para rever e partir para C ou B:**
- uma 2.4.x **estável**, com Baileys ≥ rc13, sem o 408 em `codesToNotReconnect`; ou
- os P0/P1 da auditoria precisarem de mais de ~5 patches na `dist` minificada (vira um fork; aí
  compensa compilar de uma revisão fixa, com a regressão do 408 revertida por nós).

---

## 10. O que peço autorização para fazer (nenhum item toca produção)

1. Criar `infra/evolution/patch-baileys-cve-2026-48063.mjs` (os dois commits) e o patch dos gatilhos
   de texto. Incluir no `Dockerfile`, com falha de build se a âncora mudar.
2. Escrever os testes das seções 7.1–7.4.
3. Documentar o procedimento de piloto (seção 8) como runbook.

O build da imagem, o piloto e o deploy ficam com você.

## Fontes

- [GHSA-qvv5-jq5g-4cgg — WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys/security/advisories/GHSA-qvv5-jq5g-4cgg)
- [CVE-2026-48063 — GitLab Advisory Database](https://advisories.gitlab.com/npm/baileys/CVE-2026-48063/), [Wiz](https://www.wiz.io/de-de/vulnerability-database/cve/cve-2026-48063), [OpenCVE](https://app.opencve.io/cve/CVE-2026-48063)
- Commits Baileys `3beb08e`, `5ddc231`, `0af2386`; tags `v7.0.0-rc.9`…`v7.0.0-rc14`
- Evolution: tags `2.3.7`, `2.4.0-rc1`, `2.4.0-rc2`, branch `develop` (`e273b90`); commits `72ca397`, `1d38d4f`, `7a55a2b`, `dd552c7`, `7db484e`, `00f8f13`; [PR #2612](https://github.com/evolution-foundation/evolution-api/pull/2612)
