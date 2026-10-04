# Fluxos — referência técnica do editor e do motor

Base para as tarefas do construtor de fluxos. Visão de produto e detalhes de cada bloco: [10 — Fluxos de automação](10-fluxos-de-automacao.md).

## Arquitetura

### Contrato (`packages/shared/src/flows.ts`)
- `FlowDefinition = { nodes: FlowNode[]; edges: FlowEdge[] }`, salvo como JSON em `Flow.definition`.
- `FlowNodeType` (união de strings) + um tipo por nó (`FlowNodeBase<'tipo', Data>`), unidos em `FlowNode`.
- `FlowEdge.sourceHandle` identifica a saída: id da opção/ramo/rótulo, `no` (Senão da Condição; `yes` no formato antigo), `done`/`fallback`; `null` = saída única.
- Condição: `normalizeCondition` (shared) lê o formato novo e o antigo; `CONDITION_OPERANDS`/`CONDITION_OPS` são a lista única de operandos e comparadores (editor e validação usam a mesma).
- `FLOW_NODE_LABEL` (nome exibido), `cloneFlowFragment` (copiar/colar/duplicar com ids novos).
- Tempo limite de resposta (Salvar/Menu): `ReplyTimeout`, `REPLY_TIMEOUT_HANDLE` (`'timeout'`); Salvar/Menu: `RETRIES_EXHAUSTED_HANDLE` (`'fallback'`, "Tentativas esgotadas"). Webhook: `WEBHOOK_METHODS`, `WEBHOOK_ERROR_HANDLE` (`'error'`), `WEBHOOK_DEFAULT_TIMEOUT_SEC`/`WEBHOOK_MAX_TIMEOUT_SEC`.
- Conteúdo: `normalizeContent` (lê `items` e o formato antigo), `CONTENT_MEDIA_RULES` + `contentMediaError` (limites do WhatsApp, usados no editor e na validação), `CONTENT_MAX_DELAY_SEC`. Conectar: `MAX_FLOW_HOPS`.

### Portável (`packages/shared/src/portable.ts`) — módulo único de exportar/importar/copiar
Genérico: `PORTABLE_VERSION`, `PortableBundle`/`toBundle` (lote `'<tipo>-bundle'`), `parsePortableFile` (individual ou lote, tudo ou nada), `copyName`/`uniqueName` (conflito de nome), `flagReconfig`. Fluxos: `scrubFlowDefinition`, `flowToPortable`, `flowTagNames`, `restoreFlowDefinition`, `renewFlowIds`, `flowFromPortable`, `parsePortableFlow(File)`. Usado pela API (exportar/importar) e pelo editor (colar de outra empresa). Respostas Rápidas já usam o envelope/lote/nomes daqui (`quick-replies/portable.ts` só define o item). Ver [Exportação, importação e cópia](#exportação-importação-e-cópia).

### Editor (`apps/web/src/components/flows/`) — React Flow `@xyflow/react` v12
| Arquivo | Papel |
|---|---|
| `FlowEditor.tsx` | Canvas, paleta, barra superior, salvar, copiar/colar/duplicar, menu de contexto, atalhos |
| `nodes.tsx` | `NODE_META` (ícone/cor/rótulo), `PALETTE_GROUPS`, um componente `*NodeView` por tipo, `nodeTypes`, `defaultData`, contextos `FlowNodeActions` e `FlowEditorRefs` (fluxos do cliente, links dos anexos, provedores dos números), `ContentPreview`, `contentWarnings` |
| `ContentPanel.tsx` | Editor das mensagens do Conteúdo (ordem, intervalo, upload com validação, prévia, avisos por provedor) |
| `NodePanel.tsx` | Painel de propriedades do bloco selecionado (um `switch` por tipo) |
| `ConditionPanel.tsx` | Editor de ramos/regras da Condição |
| `DeletableEdge.tsx` | Aresta com botão de tesoura (cortar ligação) |
| `layout.ts` | `autoLayout` (Organizar automaticamente) e `looksVertical` (detecta desenho antigo) |
| `TextWithVars.tsx` | Campo de texto com "Inserir variável" (+ botões N/I/S com `formatting`); `WaText` (prévia da formatação do WhatsApp); `collectFlowVars`, `SYSTEM_VARS` |
| `history.ts` | `useHistory` — desfazer/refazer por fotos do estado (`HISTORY_LIMIT` = 100) |

Persistência: estado local (`useNodesState`/`useEdgesState`) → `save()` monta o `FlowDefinition` → `onSave` (página `app/(app)/fluxos/[id]`) → `PATCH /flows/:id` com a `version` carregada. Nada é salvo sozinho; "não salvo" compara snapshot do conteúdo.

### Atalhos, histórico e alterações não salvas
- **Atalhos** (Cmd no Mac): Ctrl+Z desfaz; Ctrl+Shift+Z ou Ctrl+Y refaz; Ctrl+S salva (sempre bloqueia o "salvar página" do navegador; ignorado enquanto já está salvando ou com a tecla segurada); Ctrl+C/V/D copiam/colam/duplicam. Com o foco num campo de texto (input de texto, textarea, select, contenteditable), Z/Y/C/V/D ficam com o campo (desfazer a digitação, copiar o texto); **Ctrl+S salva mesmo digitando**. Com algo aberto por cima — modal, menu de contexto do canvas, lista "Inserir variável" (qualquer elemento com `data-overlay`; o `Modal` de `components/ui` já tem) — **nenhum atalho do editor age** (Ctrl+S só é barrado para o navegador não salvar a página).
- **Histórico** (`history.ts`): guarda fotos de `{ nodes, edges, meta }` — cobre criar/apagar/mover cards, ligações, conteúdo dos blocos e configurações do fluxo. A chave da foto é o mesmo snapshot do "não salvo" (seleção, medidas e zoom não viram passo). Mudanças seguidas em 400 ms viram um passo só (digitação); arrastando, só grava ao soltar. Máximo de 100 passos; fazer algo novo depois de desfazer descarta o "refazer". Recarregar o editor (conflito de versão) zera o histórico. Salvar não zera: dá para desfazer além do último salvo (volta a marcar "não salvo").
- **Não salvo** (`dirty`): etiqueta "Alterações não salvas" na barra superior. Proteção em `apps/web/src/lib/unsaved-guard.tsx` (`useUnsavedGuard`, genérico): `beforeunload` (recarregar/fechar a aba → aviso do navegador); clique em link interno (`<a>`/`next/link`, mesma origem, sem `target`/Ctrl/Cmd) interceptado na captura → modal "Você tem alterações não salvas. Deseja realmente sair sem salvar?" (*Sair sem salvar* / *Continuar editando*); botão Voltar → com alterações, o guarda empilha uma cópia da entrada atual (`history.state.__unsavedGuard`), o Voltar cai nela e abre o mesmo modal. Navegação por código (`router.push` fora do editor) **não** é interceptada.

### Controle de versão ao salvar
Optimistic locking em `Flow.version` (começa em 1).
- **Toda escrita incrementa**: `PATCH /flows/:id` (editor e interruptores da lista), `POST /flows/active` (lote) e a troca do nome de faixa de horário nas condições ([Horários](horarios.md#integração-com-fluxos)).
- O editor manda `version` = a que carregou (a página guarda num `ref`; só muda ao carregar, recarregar ou depois de salvar — refetch em segundo plano não adianta a versão). A API grava com `updateMany` condicional (`id` + `tenantId` + `version`); não casou → **409 `{ code: 'flow_version_conflict' }`**.
- Na tela: modal "Este fluxo foi alterado por outra pessoa ou pelo sistema. Recarregue para ver a versão atual." com **Recarregar** (refaz o GET e remonta o editor, descartando as alterações locais). Fechar o aviso mantém o rascunho na tela, mas salvar vai dar 409 de novo até recarregar.
- `PATCH` sem `version` (interruptor ativo/atalho da lista) não checa, só incrementa — o editor aberto daquele fluxo passa a receber 409.

### Motor (`apps/api/src/modules/flows/`)
| Arquivo | Papel |
|---|---|
| `flow-engine.service.ts` | `start`, `onInbound` (faixa de horário → boas-vindas → atendimento normal), `resume`, `advance` (switch por `node.type`), `deliverAnswer` (resposta em nó que espera), `retry`, `act`, `evaluate`, `distribute` |
| `flows.controller.ts` | CRUD, duplicar/ativar/exportar/importar (individual e em lote), execuções, disparo manual, parar. `GET /flows/:id` devolve também `mediaUrls` (link assinado de 1h por anexo, para a prévia); `GET /flows/:id/references` lista os fluxos que conectam a este |
| `flow-validation.ts` | `validateDefinition` — regras por tipo ao salvar; `assertOwnFlowMedia` — anexo só do próprio cliente (criar, editar, importar) |
| `conditions.ts` | Avaliador da Condição (puro): registro `OPERANDS`, comparadores, `pickBranch` |
| `variables.ts` | Operações do Manipulador (puro): `applyAssignments` |
| `answer.ts`, `distribution.ts`, `webhook.ts`, `ai-turns.ts`, `default-flows.ts`, `schedule-misses.ts` | Helpers do motor |
| `hours-gate.ts` | `planInbound`: o que fazer com a mensagem conforme a faixa de horário (boas-vindas, resposta da faixa, seguir/parar) — ver [Horários](horarios.md) |
| `flows.module.ts` | Fila BullMQ `flows`: job `resume` (Atraso/intervalo do Conteúdo), `reply-timeout` (tempo limite do Salvar/Menu), `unpause` (fim automático da pausa do robô) e `auto-content` (intervalo das mensagens automáticas de boas-vindas/faixa) |

Execução: um `FlowRun` por conversa (iniciar outro para o atual). `advance` executa nós em sequência (máx. 50 passos) até um que espera (`status: waiting`) ou termina. Saída por `goNext(handle)` → `edgeFrom`, que cai na saída sem handle se a pedida não existir; sem aresta = fluxo termina `done`.

### Como adicionar um tipo de nó (checklist)
1. `shared/flows.ts`: tipo em `FlowNodeType`, `XxxNode`, união `FlowNode`, `FLOW_NODE_LABEL` (+ build do shared).
2. `nodes.tsx`: `NODE_META`, `PALETTE_GROUPS`, `XxxNodeView` (`<In/>` + `<Out/>` ou `<OutRow id>` por saída), `nodeTypes`, `defaultData`.
3. `NodePanel.tsx`: formulário.
4. `flow-engine.service.ts`: `case` em `advance` (e em `deliverAnswer` se esperar resposta).
5. `flow-validation.ts` e, se tiver referências do tenant (tag, atendente, fluxo, token), `scrubFlowDefinition` em `shared/portable.ts`.
6. Se esperar tempo (job): checar `jobBlocked` (pausa + conversa encerrada) antes de agir e disputar o run com update condicional (ver [Tempo limite de resposta](#tempo-limite-de-resposta-salvar-e-menu)).

## Status dos blocos pedidos

| Bloco | Status | Nome / tipo atual | Observações |
|---|---|---|---|
| Conteúdo | Existe (tarefa 1.4) | Conteúdo / `message` | Várias mensagens em sequência (texto, imagem, vídeo, documento, áudio PTT/arquivo), reordenáveis, intervalo opcional, prévia. Ver [Conteúdo](#conteúdo). Botões continuam no Menu. |
| Menu | Revisado (tarefa 1.7) | Menu / `menu` | Opções numeradas (uma saída cada); resposta por número ou texto sem diferenciar maiúsculas/acentos; mensagem de inválida + tentativas; saídas **Tentativas esgotadas** e **Não respondeu** (tempo limite). Ver [Menu](#menu). |
| Manipulador | Existe (tarefa 1.2) | Manipulador / `variable` (e legado `action.set_var`) | Várias operações em ordem: definir, somar, subtrair, acrescentar texto, limpar, copiar, data/hora atual. Escopo: execução do fluxo (ver abaixo). Não grava na ficha do contato (isso é o *Salvar* com campo do contato). |
| Ação | Revisado (tarefa 1.7) | Ação / `action` | Etiqueta (conversa/contato), atribuir, status, encerrar conversa, transferir para humano, webhook completo (método, headers, corpo, tempo limite, resposta, saída Erro). Ver [Ação](#ação). |
| Randomizador | Existe | Randomizador / `randomizer` | Ramos com peso, uma saída por ramo. |
| Condição | Existe (tarefa 1.2; operandos de horário na tarefa 2) | Condição / `condition` | Ramos em ordem com regras E/OU, saída por ramo + Senão. Texto, número, existência, dia da semana, horário entre, etiqueta, **dentro do horário de atendimento**, **faixa de horário atual é**. Formato antigo convertido na leitura. |
| Atraso inteligente | Revisado (tarefa 1.7) | Atraso inteligente / `wait` | Minutos/horas/dias (job persistente), opcional respeitar expediente, ou **até o próximo horário de atendimento**. Checa pausa e conversa encerrada. Ver [Atraso inteligente](#atraso-inteligente). |
| Salvar (aguardar resposta com tempo limite) | Existe | Salvar / `question` | Espera resposta, valida (e-mail/telefone/número), grava em variável e opcionalmente na ficha. Mesmas saídas do Menu: **Tentativas esgotadas** e **Não respondeu** (tempo limite) — implementadas na tarefa 1.7, ver [Tempo limite](#tempo-limite-de-resposta-salvar-e-menu). |
| Distribuidor | Existe | Distribuidor / `distributor` | Rodízio, menos ocupado, fila; saídas Distribuído / Ninguém disponível. |
| Conectar com outro fluxo | Existe (tarefa 1.4) | Conectar com outro fluxo / `connect_flow` | Sem retorno; variáveis seguem; proteção contra loop. Ver [Conectar com outro fluxo](#conectar-com-outro-fluxo). |

Outros tipos existentes não pedidos: Início (`start`), Fim (`end`), IA (`ai`), Agendar horário (`schedule`).

## Recursos do editor

- **Ativar/desativar fluxo**: existe — checkbox "Fluxo ativo" no editor e interruptor direto na lista (`/fluxos`, só com `flows.manage`). Ativar valida o desenho salvo (400 com o motivo se inválido). Fluxo inativo não dispara nem aparece no chat; **conversas que já estão no meio dele continuam até o fim** (`onInbound` entrega a resposta ao run ativo sem olhar `isActive`).
- **Pausar o robô numa conversa**: existe (tarefa 1.5) — ver [Pausar o robô na conversa](#pausar-o-robô-na-conversa).
- **Ações em lote na listagem**: checkbox por fluxo + "selecionar todos" → Ativar, Desativar, Duplicar, Exportar selecionados (tarefa 1.7). Ver [Exportação, importação e cópia](#exportação-importação-e-cópia).
- **Duplicar fluxo**: existe (`POST /flows/:id/duplicate` e em lote; cópia nasce inativa).
- **Duplicar bloco**: existe (tarefa 1.1) — botão no card, Ctrl/Cmd+D, menu de contexto. Sem ligações.
- **Desfazer/refazer, Ctrl+S e aviso de alterações não salvas**: existe — ver [Atalhos, histórico e alterações não salvas](#atalhos-histórico-e-alterações-não-salvas).
- **Copiar/colar blocos** entre fluxos: existe (Ctrl+C/V, `localStorage`) — confirmado na tarefa 1.7: ligações internas da seleção preservadas, as que saem dela descartadas; colar vindo de **outra empresa** passa pela limpeza da importação.
- **Conexões laterais**: entrada à esquerda, saídas à direita, uma por opção (tarefa 1.1). Ids de handle iguais aos antigos, então fluxos salvos continuam ligados.
- **Organizar automaticamente**: botão na barra; aviso quando o desenho parece vertical. Nunca roda sozinho.
- **Cortar ligação**: tesoura no meio da aresta (hover/seleção) ou Delete/Backspace.

## Condição

Dados: `{ branches: ConditionBranch[] }`. Cada ramo `{ id, label, match: 'all' | 'any', rules }`; a saída do ramo é `sourceHandle = id do ramo`. Ramos avaliados de cima para baixo, **o primeiro verdadeiro vence**; nenhum → `CONDITION_ELSE` (`'no'`, saída **Senão**, sempre presente). Ramo sem regras nunca vence (e não passa na validação).

Regra `ConditionRule`: `operand` + `key` (variável ou campo) + `op` + parâmetros do comparador.

| Operando | Valor | Comparadores |
|---|---|---|
| `var` — variável do fluxo (`key` = nome) | texto | igual, diferente, contém, não contém, começa com, termina com · `=` `≠` `>` `≥` `<` `≤` (número) · vazio, não vazio |
| `contact` — campo da ficha (`key`: name, phone, email, address, note1, note2) | texto | idem |
| `message` — última mensagem **recebida** do contato na conversa | texto | idem |
| `now` — data/hora atual, **no fuso do cliente** | data/hora | dia da semana em lista (`days`, 0 = domingo) · horário entre `from` e `to` (HH:MM; início inclusivo, fim exclusivo; `22:00–06:00` atravessa a meia-noite) |
| `tag` — conversa **ou** contato tem a etiqueta `tagId` | sim/não | `is_true` / `is_false` |
| `business_hours` — **dentro do horário de atendimento**: faixa atual do quadro do número da conversa conta como atendimento ([Horários](horarios.md); "atendimento desativado" = fora); `hours` opcional = horário próprio (formato antigo) | sim/não | `is_true` / `is_false` |
| `schedule_band` — **faixa de horário atual é** `band` (nome da faixa, ou `closed` = Fechado; sem diferenciar maiúsculas/acentos) | sim/não | `is_true` (é) / `is_false` (não é) |

- Texto: compara depois de `trim`, **sem diferenciar maiúsculas/minúsculas e acentos** (`fold`: NFD sem diacríticos + minúsculas). `caseSensitive: true` na regra compara exato.
- Número: aceita vírgula decimal (`10,5`, `1.234,56`) e ponto (`10.5`). Se qualquer lado não for número (inclusive vazio), a regra é **falsa** — também para `≠`.
- `value` aceita `{{variáveis}}` (comparar duas variáveis: `value = "{{outra}}"`).
- **Plugar operando novo** (como foi feito com `schedule_band` na tarefa 2): acrescentar em `ConditionOperand` e `CONDITION_OPERANDS` (shared, com o `kind` — os comparadores do kind passam a valer sozinhos), uma entrada em `OPERANDS` (`conditions.ts`) e, se precisar de banco/config, uma função preguiçosa em `RuleEnv` montada em `FlowEngineService.evaluate`. Os dados externos só são buscados quando alguma regra usa o operando (`once` memoiza por avaliação). Operando desconhecido é avaliado como falso.
- **Compatibilidade**: nó salvo no formato antigo (`kind`/`varName`/`value`/`tagId`/`hours`) é lido por `normalizeCondition` como **um ramo de id `yes`** ("Sim") + Senão `no` — exatamente os handles antigos, então as ligações continuam valendo sem migração. `var_equals`→igual, `var_contains`→contém, `var_filled`→não vazio (`contact.x` vira operando `contact`), `has_tag`→etiqueta, `business_hours`→horário comercial (com `hours` se tinha). Diferença: a comparação de texto agora também ignora acentos. O banco só muda quando o bloco é editado e salvo (o painel grava `branches` e apaga os campos antigos).
- Exportar/importar: `tagId` dentro das regras também vira `tagName` (`portable.ts`, `tagHolders`).

## Manipulador

Tipo interno continua `variable` (fluxos salvos intactos); só o nome exibido mudou. `assignments: { id, varName, op?, value, from?, format? }[]`, executadas em ordem — cada operação já vê o resultado da anterior. `op` ausente = `set` (formato antigo).

| `op` | Efeito |
|---|---|
| `set` | `varName = interpolate(value)` |
| `add` / `subtract` | número atual (vazio = 0) ± `interpolate(value)`. Aceita vírgula decimal; resultado com ponto e até 6 casas (`0,1 + 0.2 = "0.3"`). Valor fixo que não é número (ou vazio) é **recusado ao salvar** (validação + aviso no painel); com `{{variável}}` só dá para saber na execução — se algum lado não for número, a variável **não muda** e a equipe é avisada (ver abaixo) |
| `append` | concatena `interpolate(value)` ao valor atual |
| `clear` | `""` |
| `copy` | valor de `from` — outra variável ou `contact.<campo>` |
| `now` | data/hora atual no fuso do cliente: `datetime` `05/10/2026 14:30`, `date`, `time` |

**Operação impossível na execução** (somar texto, valor atual não numérico): o fluxo **não para** — o atendimento continua —, mas nunca fica em silêncio. `applyAssignments` devolve `problems` e o motor chama `warnTeam`: grava uma **nota interna** na conversa (autor "robô do fluxo", só a equipe vê, não vai ao WhatsApp nem conta no uso — `ConversationsService.systemNote`) e marca a execução com `error = "aviso — …"`, que aparece na lista de execuções do editor mesmo com status *concluído*.

**Interpolação** (padrão do projeto, `answer.ts → interpolate`): `{{nome_da_variavel}}` e `{{contact.<campo>}}` (name, phone, email, address, note1, note2); espaços dentro das chaves são aceitos; chave inexistente vira texto vazio. Vale em todo texto enviado, nos valores do Manipulador e nos valores das regras da Condição.

## Variáveis: escopo e persistência

- **Escopo = execução do fluxo** (`FlowRun`), não conversa nem global. As variáveis ficam em `FlowRun.vars` (JSON, `Record<string, string>`), começam vazias em `start()` e são gravadas no banco a cada bloco que as altera (Salvar, Menu, Manipulador, webhook, IA, Agendar).
- Valem do ponto em que são definidas até o fim **daquela** execução, inclusive através de esperas (Atraso, Salvar, Menu), porque o run é recarregado do banco a cada passo.
- Iniciar outro fluxo na conversa (manual, gatilho, encerramento) cria um run novo, **com variáveis vazias**; as do run anterior ficam só no histórico de execuções. Exceção: o bloco **Conectar com outro fluxo** passa as variáveis do run de origem para o novo (menos as internas `_…`).
- O nome antigo "Variável global" era enganoso: não há variável global por cliente nem por contato. Dado que precisa sobreviver ao fluxo vai para a **ficha do contato** (bloco Salvar com campo do contato) ou etiqueta.
- Chaves que começam com `_` são internas do motor (`_aiTurns`, `_sched`, `_content`, `_flowHops`) e não vão no webhook nem para o fluxo conectado (exceto `_flowHops`, que é o contador do próprio salto).

## Conteúdo

Dados: `{ items: ContentItem[] }`, enviados **na ordem da lista**. Cada item `{ id, kind, text?, mediaKey?, mediaName?, mimeType?, size?, voice?, delay? }`:

| `kind` | Envio | Observação |
|---|---|---|
| `text` | `text` interpolado | Formatação do WhatsApp (`*negrito*`, `_itálico_`, `~tachado~`) vai como está — o app do contato formata. Texto que fica vazio depois da interpolação não é enviado. |
| `image` / `video` | anexo + `text` como legenda | |
| `document` | anexo + legenda; `mediaName` é o nome que o contato vê (editável no painel) | |
| `audio` | sem legenda. `voice` ausente/`true` = **áudio gravado (PTT)**; `false` = **arquivo** | Fica em `Message.raw.voice` (só quando `false`) e chega ao adapter em `OutboundMessage.media.voice`. |

- **Intervalo**: `delay` (segundos, 0–`CONTENT_MAX_DELAY_SEC` = 300) é a espera **antes** daquele item; ignorado no primeiro. Mensagem adicionada no editor depois de outra já nasce com **1 s** (pode zerar); itens sem `delay` (blocos antigos) continuam sem intervalo. O motor envia até o próximo item com intervalo, grava `_content = "<nó>:<índice>"` no run, fica `waiting` com `waitUntil` e agenda o job `resume` (mesma fila do Atraso). `resume` vê o `_content` do nó atual e continua no mesmo nó (`advance`) em vez de seguir pela saída; ao terminar o bloco, `_content` é apagado. Mensagem do contato durante o intervalo é ignorada (como no Atraso). Parar o fluxo no meio cancela o resto.
- **Ordem garantida pela fila** (tarefa 3): mensagens da mesma conversa saem uma de cada vez, na ordem em que foram enfileiradas, mesmo com mídia grande e blocos seguidos — ver [Envio](envio.md#ordem-por-conversa). O intervalo do item não é mais necessário para a ordem; continua valendo como espera adicional (aplicada antes de enfileirar, somada ao intervalo mínimo da conversa). O padrão de 1 s nas mensagens novas foi mantido.
- **Upload**: `POST /uploads` (storage do projeto). O editor checa formato e tamanho antes de subir (`contentMediaError`) e mostra o erro no item; a API checa de novo ao salvar (`mimeType`/`size` gravados no item). Arquivo maior que `MEDIA_MAX_MB` (padrão 25) é recusado pelo upload com "maior que o limite de upload do servidor".

| Formato | Tipos | Limite WhatsApp |
|---|---|---|
| Imagem | JPG, PNG, WebP | 5 MB |
| Vídeo | MP4, 3GP | 16 MB |
| Áudio | OGG, MP3, M4A, AAC | 16 MB |
| Documento | PDF, Word, Excel, PowerPoint | 100 MB (na prática, o teto do upload) |

**Suporte por provedor** (avisos no card e no painel via `contentWarnings`, só para os provedores que o cliente usa):

| | Evolution | Meta (Cloud API) |
|---|---|---|
| Texto + formatação | ✅ | ✅ |
| Imagem/vídeo/documento com legenda | ✅ | ✅ (vídeo só H.264 + AAC — aviso fixo no painel) |
| Imagem WebP | ✅ | ❌ recusada → aviso |
| Áudio gravado (PTT) | ✅ `sendWhatsAppAudio` (converte qualquer formato) | Só OGG/Opus aparece como voz; outros chegam como arquivo de áudio → aviso |
| Áudio como arquivo | ✅ vai como documento (`sendMedia` `mediatype: document`) | ⚠️ não existe: chega como áudio para tocar → aviso |

No adapter da Meta, legenda só vai em imagem/vídeo/documento e `filename` só em documento (`metaMediaExtras`) — áudio com `caption` era recusado.

**Compatibilidade**: bloco salvo no formato antigo (`text`/`mediaKey`/`mediaType`/`mediaName`) é lido por `normalizeContent`: só texto → 1 texto; anexo + texto → 1 item com legenda (o mesmo envio de antes); **áudio + texto → áudio e depois o texto** (antes o texto se perdia). O banco só muda quando o bloco é editado e salvo (o painel grava `items` e apaga os campos soltos). Anexo sem `mimeType`/`size` (antigo) não é revalidado.

## Conectar com outro fluxo

Dados: `{ flowId }` (`flowName` só no arquivo exportado). Sem saída: o fluxo atual termina ali.

- **Motor** (`connectFlow`): busca o destino **do mesmo tenant**. Se ok: o run atual termina `done` com `error = 'seguiu para o fluxo "X"'` e `start(destino, conversa, undefined, { vars })` cria o run novo do Início, com as variáveis do atual (menos as `_…`). Não há retorno.
- **Destino excluído ou desativado**: não salta. `warnTeam` (log + nota interna + aviso na execução) e `handoff`: se a conversa já tem atendente, **continua com ele** (status *Em atendimento*); sem atendente, vai para a fila "Aguardando".
- **Loop**: `_flowHops` conta saltos seguidos e segue para o run novo. Passou de `MAX_FLOW_HOPS` (5) → mesmo tratamento do destino inválido. O contador **zera quando o contato responde** (`deliverAnswer`): só saltos automáticos contam, então "voltar ao menu principal" (menu → outro fluxo → menu…) não esbarra no limite.
- **Editor**: select com os fluxos do cliente (`useFlows`), marcando "(desativado)" e "(este fluxo — recomeça)"; card mostra o nome do destino, atalho para abrir em nova aba (não perde o que não foi salvo) e faixa vermelha se o destino foi excluído ou está desativado.
- **Excluir fluxo**: a lista chama `GET /flows/:id/references` antes de abrir a confirmação e cita os fluxos que apontam para ele.
- **Exportar/importar**: `flowId` sai (vira `flowName`), card marcado *Reconfigurar*; a validação aceita o card sem destino enquanto marcado. Duplicar no mesmo cliente mantém o destino.


## Pausar o robô na conversa

Tarefa 1.5. O atendente desliga a automação **só na conversa aberta**; os outros contatos seguem com o robô normal.

**O que já existia antes** (continua igual): botão "Parar e assumir" (faixa "Fluxo X está atendendo" e o ⏸ da barra do campo) — `POST /conversations/:id/flow/stop` para o run atual, mas a próxima mensagem do contato pode disparar gatilho/fluxo padrão de novo. **Nada para o robô sozinho** quando o atendente assume ou envia mensagem: o fluxo continua rodando junto. A pausa é o jeito de garantir silêncio do robô por um tempo.

**Dados** (`Conversation`): `botPausedAt`, `botPausedById`, `botPausedUntil` (nulo com `botPausedAt` preenchido = até retomar manualmente). Pausado = `botPaused(conv)` (`conversations/bot-pause.ts`): `botPausedAt` preenchido e `botPausedUntil` nulo ou no futuro — pausa vencida conta como retomada mesmo se o job do fim atrasar.

**API**: `POST /conversations/:id/bot/pause` `{ minutes: 30 | 60 | 240 | null }` e `POST /conversations/:id/bot/resume` (`ConversationScopeGuard`; sem permissão própria — quem vê a conversa pode pausar). Pausar de novo com a pausa ativa troca a duração, contando de agora. Conversa encerrada → 400.

**Enquanto pausado** (`FlowEngineService`):
- `pauseBot` grava a pausa e chama `stop` → o run ativo termina `stopped` com `error = "robô pausado na conversa"`.
- `onInbound`: mensagem não inicia fluxo (gatilho, padrão), não entrega resposta a run e não manda boas-vindas. **A mensagem da faixa de horário (ex.: Fechado) continua saindo**, uma vez por período — mudança da tarefa 2 (antes, pausado não recebia nem o aviso de fora do expediente); fluxo de faixa não inicia. Ver [Horários](horarios.md#comportamento-ao-receber-mensagem). A resposta "1/2" a lembrete de agendamento (`SchedulingService.onInbound`) continua funcionando — não é fluxo.
- `start` recusa (400 "O robô está pausado…"). **Disparo manual** pelo atendente (`POST /flows/:id/start`): responde 409 `{ code: 'bot_paused' }`; a tela pede confirmação ("Retomar o robô e iniciar o fluxo?", `components/chat/useStartFlowConfirm.tsx`) e, confirmado, reenvia com `resumeBot: true` — a API retoma o robô (evento `bot_resumed` com o atendente) e inicia.
- Rotas de pausar/retomar exigem a feature `flows` do plano (`@RequireFeature('flows')`). O fim da pausa (`botPausedUntil`) é gravado em UTC e a tela mostra no fuso do navegador de quem lê.
- `resume` (job do Atraso/intervalo do Conteúdo), `replyTimeout` (tempo limite do Salvar/Menu) e cada passo de `advance` checam `botPaused(run.conversation)` e encerram o run como `stopped` em vez de executar. Os jobs usam `jobBlocked`, que também encerra o run se a conversa estiver **encerrada**. **Todo job novo do motor** deve usar `jobBlocked` antes de agir.

**Fim da pausa**:
- Automático: job `unpause` na fila `flows` (delay até `botPausedUntil`, `jobId = unpause-<conversa>-<pausedAt ms>`). Só limpa se `botPausedAt` ainda é o da pausa que agendou — pausar de novo ou retomar à mão deixa o job antigo sem efeito. Se o job atrasar, a primeira mensagem do contato depois do horário já limpa a pausa (`onInbound`) e segue normal.
- Manual: "Retomar robô".
- Em ambos, **a execução interrompida não volta**: a próxima mensagem do contato passa pelas regras de entrada (faixa de horário, gatilho, fluxo padrão).
- Encerrar o atendimento (`setStatus`, `setStatusSystem` — inclusive Fim com "encerrar conversa" —, encerrar em massa e `sendToPhone` com `closeAfter`) limpa a pausa. O fluxo de encerramento (pesquisa) roda normalmente, porque a pausa já foi limpa antes dele.

**Histórico** (`conversation_events`): `bot_paused` (ator = quem pausou; `reason` = "por 30 min" / "por 1 h" / "por 4 h" / "até retomar manualmente") e `bot_resumed` (ator = quem retomou; nulo = automático, com `reason` "fim do tempo de pausa" ou "atendimento encerrado"). Aparece no "Histórico do atendimento".

**Tela** (`components/chat/BotPauseBar.tsx`, só com a feature `flows`): botão "Pausar robô" abaixo do campo de mensagem → 30 min, 1 h, 4 h, até retomar. Pausado: no lugar dele, aviso "Robô pausado por <atendente> até <hora>" (ou "até retomar manualmente") + "Retomar robô". Selo "Robô pausado" no cabeçalho do chat e ícone no card da lista (no lugar do 🤖). Tempo real: toda mudança emite `conversation` pelo socket, que já invalida conversa, lista e histórico nos outros atendentes. A barra só aparece no campo normal de resposta (não no modo nota interna de gerente, número desconectado ou cota estourada); o selo aparece sempre.


## Menu

Tarefa 1.7. Dados: `{ text, options: {id,label}[], invalidText?, maxRetries, timeoutMinutes?, timeoutUnit? }`.

- **Opções numeradas**, uma saída por opção (`sourceHandle` = id da opção). Meta: botões/lista; Evolution: texto numerado (`sendMenu`).
- **Resposta aceita** (`answer.ts → choose`): toque no botão (id), **número** (`2`, `2.`, `2)`, com espaços) ou **texto da opção** sem diferenciar maiúsculas, acentos e espaços extras (`Promoção` = `promocao`); por último, texto contido no título (3+ letras). A escolha vai para `{{menu_<id>}}` (título da opção).
- **Resposta inválida**: envia `invalidText` (padrão "Opção inválida. Responda com o número da opção.") **com as opções de novo** e conta tentativa. Passou de `maxRetries` → saída **Tentativas esgotadas** (`fallback`, mesmo id de antes: fluxos salvos continuam ligados); sem ela ligada → entrega para humano.
- **Tempo limite**: o mesmo do Salvar — ver abaixo. Saída **Não respondeu** (`timeout`).

**Salvar e Menu se comportam igual** nas saídas de exceção (decisão da tarefa 1.7):

| Situação | Saída ligada | Saída não ligada |
|---|---|---|
| Tentativas esgotadas (`maxRetries` respostas inválidas) | **Tentativas esgotadas** (`fallback`) | entrega para humano (volta para a fila "Aguardando", sem atendente) |
| Tempo limite vencido | **Não respondeu** (`timeout`) | o fluxo **termina** (`done`), sem passar para humano |

No Salvar a resposta inválida é a que não passa na validação (e-mail/telefone/número) ou vazia; a mensagem é `invalidText` (padrão "Não entendi. Pode repetir?").

## Tempo limite de resposta (Salvar e Menu)

Tarefa 1.7. A tarefa 1.6 (Salvar) ainda não tinha sido feita; o mecanismo foi criado aqui, genérico, e vale para os dois blocos.

- **Dados**: `timeoutMinutes` (total; 0/ausente = espera indefinidamente, como antes) + `timeoutUnit` (só exibição) + `timeoutBusinessHours` (tarefa 2: conta só dentro do horário de atendimento do quadro do número — `SchedulesService.addOpenMinutes`; atendimento desativado = tempo corrido). Validação: 0 a 30 dias.
- **Job**: ao esperar (`awaitReply`), o run fica `waiting` com `waitUntil = agora + tempo` e é agendado `reply-timeout` `{ runId, nodeId, until }` (`jobId = timeout-<run>-<nó>-<until ms>`). **Cada nova tentativa** (resposta inválida) recomeça a contagem: novo `waitUntil`, novo job; o antigo vira inofensivo.
- **Ao vencer** (`replyTimeout`): só age se o run ainda está `waiting` no mesmo nó com o mesmo `waitUntil`. `jobBlocked`: robô pausado ou conversa encerrada → run `stopped` (motivo "robô pausado na conversa" / "conversa encerrada"). Senão segue pela saída **Não respondeu**; **sem ela ligada, o fluxo termina** (`done`, "contato não respondeu no tempo limite") — não cai na saída de resposta nem entrega para humano.
- **Disputa** (contato responde no mesmo instante em que vence): os dois lados tiram o run de `waiting` com `updateMany` condicional (`status = waiting` + nó [+ `waitUntil`]). Quem conseguir segue; o outro não faz nada. Resposta que perde a disputa é só uma mensagem normal na conversa.
- **Parar / pausar / substituir** o run no meio: o job encontra o run fora de `waiting` e não faz nada.
- Tela: card mostra a linha **Não respondeu em X** só com tempo limite. O Salvar mostra **Respondeu** (a saída padrão, mesmo handle de sempre) e **Tentativas esgotadas**. A faixa do chat mostra "aguardando até HH:MM".

## Ação

Ações disponíveis (`ActionNode.kind`):

| Ação na tela | Dado | Efeito |
|---|---|---|
| Aplicar / Remover etiqueta | `add_tag` / `remove_tag` + `tagId` + `scope` | Na conversa (padrão) ou 📌 no contato |
| Atribuir a atendente | `assign` + `agentId` | Atribui e põe *Em atendimento*; o fluxo continua |
| Mudar status | `set_status` + `waiting`/`in_progress` | `setStatusSystem` |
| **Encerrar conversa** | `set_status` + `closed` | Mesmo dado de antes, só ganhou entrada própria no seletor. Encerra (fluxo de encerramento roda, pausa é limpa). Depois disso, jobs do fluxo (Atraso, tempo limite) param por `jobBlocked` |
| Transferir para atendente humano | `handoff` + `agentId?` | Fila "Aguardando" ou atendente escolhido; **termina o fluxo** (sem saída) |
| Chamar webhook | `webhook` | Ver abaixo |
| Definir variável (legado) | `set_var` | Só aparece em fluxos antigos; use o Manipulador |

**Webhook** (`webhook.ts → callWebhook`, `FlowEngineService.webhook`):
- `method`: GET, POST (padrão), PUT, PATCH, DELETE. GET/DELETE vão sem corpo.
- `url`: aceita `{{variáveis}}` (valores com `encodeURIComponent`). Proteção SSRF de sempre (só http/https, portas 80/443, sem IP interno após DNS, sem seguir redirecionamento).
- `headers: {id,key,value}[]`: valor aceita `{{variáveis}}`. Ignorados: nome inválido e `Host`, `Content-Length`, `Connection`, `Transfer-Encoding`, `Proxy-*` e afins. Quebras de linha no valor viram espaço.
- `body`: texto com `{{variáveis}}`. Se o `Content-Type` (header; padrão `application/json`) for JSON, cada valor entra com **escape de JSON** (`jsonEscape`) — aspas/quebras no nome do contato não quebram o corpo. **Vazio = formato antigo**: `{ event: 'flow.webhook', flowId, conversationId, contact, vars }` (sem as `_…`).
- `timeoutSec`: 1–30 (padrão 8).
- `responseVar`: guarda o corpo da resposta (até 2.000 caracteres); vazio em erro.
- **Saídas**: normal (Sucesso — mesmo handle de antes) e **Erro** (`error`): rede/DNS, tempo esgotado, endereço interno, status ≠ 2xx (inclui 3xx). Sem *Erro* ligada, segue pela normal — comportamento antigo.

## Atraso inteligente

Dados: `{ mode?, minutes, unit?, businessHours? }`.

- `mode` ausente/`duration`: espera `minutes` (total; `unit` só exibição). Com `businessHours`, se o prazo cair fora do horário de atendimento, empurra para a próxima abertura.
- `mode: 'next_open'`: **até o próximo horário de atendimento** — segue na hora se já estiver aberto (ou com o atendimento desativado, ou se o quadro não abrir em 14 dias).
- O horário é o **quadro de horários do número da conversa** (ou o padrão do cliente), faixas que contam como atendimento: `SchedulesService.nextOpen` ([Horários](horarios.md#integração-com-fluxos)).
- Job persistente `resume` na fila `flows` (BullMQ/Redis, sobrevive a reinício da API). Ao vencer, `jobBlocked`: robô pausado ou conversa encerrada → run `stopped`. Mensagem do contato durante a espera é ignorada.

## Exportação, importação e cópia

Tarefa 1.7. Tudo passa pelo módulo único `packages/shared/src/portable.ts` (puro, sem Prisma).

- **Arquivo individual**: `{ atendo: 'flow', version: 1, name, description?, trigger, definition }`. **Lote**: `{ atendo: 'flow-bundle', version: 1, items: [<individual>…] }` (até 100).
- **Listagem** (`/fluxos`): checkbox por fluxo + "selecionar todos" → **Ativar**, **Desativar** (`POST /flows/active`; ativar valida cada desenho, os inválidos ficam como estavam e aparecem com o motivo), **Duplicar** (`POST /flows/duplicate`), **Exportar selecionados** (`POST /flows/export`, um arquivo `.fluxos.json`). Importar aceita individual ou lote.
- **Não sai do cliente** (`scrubFlowDefinition`, com aviso e marca `_reconfig` no card): etiqueta vira nome; atendente(s), serviço/profissional, anexos (chave com o tenant), destino do Conectar (fica o nome), URL do webhook, **headers sensíveis do webhook** (`isSensitiveHeader`: `Authorization`, `X-Api-Key` e qualquer nome com `token` ou `secret`, removidos inteiros — os demais headers viajam com valor), números do gatilho.
- **Corpo do webhook** viaja (é conteúdo). Se algum webhook do arquivo tiver corpo (`hasWebhookBody`), a listagem mostra antes de baixar: *"Este arquivo contém o corpo de webhooks. Verifique se não há tokens ou senhas."* — baixa só se confirmar.
- **Importação** (`flowFromPortable`): todo bloco de webhook ganha a marca **Reconfigurar: revisar configuração** (`WEBHOOK_REVIEW_FLAG`; some ao editar o bloco); etiquetas criadas se faltarem (sem correspondência → sai do bloco com `_reconfig`), **ids novos para todos os nós e ligações** (`renewFlowIds`, reescreve `{{menu_<id>}}`), nome repetido → " (cópia)" (`uniqueName`), nasce desativado, tudo ou nada.
- **Copiar/colar cards** (Ctrl+C/V): a área de transferência guarda também o `tenantId` e os nomes de etiquetas/fluxos de origem. Colando na **mesma empresa**, cópia literal (ids novos, ligações internas preservadas, as que saem da seleção descartadas). Colando em **outra empresa** (super admin entrando como clientes diferentes no mesmo navegador), passa por `scrubFlowDefinition` + `restoreFlowDefinition` com as etiquetas do destino — mesmas regras da importação, avisos na tela.
- **Copiar para outra empresa** (ação na listagem): **não implementado** — o sistema não tem usuário com acesso a mais de uma empresa (`User.tenantId` único; só o super admin entra como cliente). Caminho atual: exportar e importar. Se surgir multiempresa, a ação é `flowToPortable` na origem + `flowFromPortable` no destino, no servidor.
- **Respostas Rápidas**: `quick-replies/portable.ts` já usa `parsePortableFile`/`toBundle`/`copyName` daqui; a tarefa delas acrescenta só a limpeza própria do item.
