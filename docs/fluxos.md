# Fluxos — referência técnica do editor e do motor

Base para as tarefas do construtor de fluxos. Visão de produto e detalhes de cada bloco: [10 — Fluxos de automação](10-fluxos-de-automacao.md).

## Arquitetura

### Contrato (`packages/shared/src/flows.ts`)
- `FlowDefinition = { nodes: FlowNode[]; edges: FlowEdge[] }`, salvo como JSON em `Flow.definition`.
- `FlowNodeType` (união de strings) + um tipo por nó (`FlowNodeBase<'tipo', Data>`), unidos em `FlowNode`.
- `FlowEdge.sourceHandle` identifica a saída: id da opção/ramo/rótulo, `no` (Senão da Condição; `yes` no formato antigo), `done`/`fallback`; `null` = saída única.
- Condição: `normalizeCondition` (shared) lê o formato novo e o antigo; `CONDITION_OPERANDS`/`CONDITION_OPS` são a lista única de operandos e comparadores (editor e validação usam a mesma).
- `FLOW_NODE_LABEL` (nome exibido), `cloneFlowFragment` (copiar/colar/duplicar com ids novos).
- Conteúdo: `normalizeContent` (lê `items` e o formato antigo), `CONTENT_MEDIA_RULES` + `contentMediaError` (limites do WhatsApp, usados no editor e na validação), `CONTENT_MAX_DELAY_SEC`. Conectar: `MAX_FLOW_HOPS`.

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

Persistência: estado local (`useNodesState`/`useEdgesState`) → `save()` monta o `FlowDefinition` → `onSave` (página `app/(app)/fluxos/[id]`) → `PATCH /flows/:id`. Nada é salvo sozinho; "não salvo" compara snapshot do conteúdo.

### Motor (`apps/api/src/modules/flows/`)
| Arquivo | Papel |
|---|---|
| `flow-engine.service.ts` | `start`, `onInbound`, `resume`, `advance` (switch por `node.type`), `deliverAnswer` (resposta em nó que espera), `retry`, `act`, `evaluate`, `distribute` |
| `flows.controller.ts` | CRUD, duplicar/exportar/importar fluxo, execuções, disparo manual, parar. `GET /flows/:id` devolve também `mediaUrls` (link assinado de 1h por anexo, para a prévia); `GET /flows/:id/references` lista os fluxos que conectam a este |
| `flow-validation.ts` | `validateDefinition` — regras por tipo ao salvar; `assertOwnFlowMedia` — anexo só do próprio cliente (criar, editar, importar) |
| `portable.ts` | Export/import entre clientes (marca `_reconfig`) |
| `conditions.ts` | Avaliador da Condição (puro): registro `OPERANDS`, comparadores, `pickBranch` |
| `variables.ts` | Operações do Manipulador (puro): `applyAssignments` |
| `answer.ts`, `distribution.ts`, `webhook.ts`, `ai-turns.ts`, `default-flows.ts`, `schedule-misses.ts` | Helpers do motor |
| `flows.module.ts` | Fila BullMQ `flows` (job `resume` do Atraso) |

Execução: um `FlowRun` por conversa (iniciar outro para o atual). `advance` executa nós em sequência (máx. 50 passos) até um que espera (`status: waiting`) ou termina. Saída por `goNext(handle)` → `edgeFrom`, que cai na saída sem handle se a pedida não existir; sem aresta = fluxo termina `done`.

### Como adicionar um tipo de nó (checklist)
1. `shared/flows.ts`: tipo em `FlowNodeType`, `XxxNode`, união `FlowNode`, `FLOW_NODE_LABEL` (+ build do shared).
2. `nodes.tsx`: `NODE_META`, `PALETTE_GROUPS`, `XxxNodeView` (`<In/>` + `<Out/>` ou `<OutRow id>` por saída), `nodeTypes`, `defaultData`.
3. `NodePanel.tsx`: formulário.
4. `flow-engine.service.ts`: `case` em `advance` (e em `deliverAnswer` se esperar resposta).
5. `flow-validation.ts` e, se tiver referências do tenant (tag, atendente, fluxo), `portable.ts`.

## Status dos blocos pedidos

| Bloco | Status | Nome / tipo atual | Observações |
|---|---|---|---|
| Conteúdo | Existe (tarefa 1.4) | Conteúdo / `message` | Várias mensagens em sequência (texto, imagem, vídeo, documento, áudio PTT/arquivo), reordenáveis, intervalo opcional, prévia. Ver [Conteúdo](#conteúdo). Botões continuam no Menu. |
| Menu | Existe | Menu / `menu` | Opções numeradas (uma saída cada) + saída "resposta inválida" após `maxRetries`. Escolha fica em `{{menu_<id>}}`. Sem tempo limite de resposta. |
| Manipulador | Existe (tarefa 1.2) | Manipulador / `variable` (e legado `action.set_var`) | Várias operações em ordem: definir, somar, subtrair, acrescentar texto, limpar, copiar, data/hora atual. Escopo: execução do fluxo (ver abaixo). Não grava na ficha do contato (isso é o *Salvar* com campo do contato). |
| Ação | Existe | Ação / `action` | Etiqueta (conversa/contato), atribuir, status, entregar para humano, webhook. |
| Randomizador | Existe | Randomizador / `randomizer` | Ramos com peso, uma saída por ramo. |
| Condição | Existe (tarefa 1.2) | Condição / `condition` | Ramos em ordem com regras E/OU, saída por ramo + Senão. Texto, número, existência, dia da semana, faixa de horário, etiqueta, horário comercial. Formato antigo convertido na leitura. |
| Atraso inteligente | Existe | Atraso inteligente / `wait` | Minutos/horas/dias, opcional respeitar expediente. Mensagem recebida durante o atraso é ignorada. |
| Salvar (aguardar resposta com tempo limite) | Existe incompleto | Salvar / `question` | Espera resposta, valida (e-mail/telefone/número), grava em variável e opcionalmente na ficha. **Falta o tempo limite** e a saída de "não respondeu" — hoje espera indefinidamente. Tentativas esgotadas → entrega para humano (não tem saída própria). |
| Distribuidor | Existe | Distribuidor / `distributor` | Rodízio, menos ocupado, fila; saídas Distribuído / Ninguém disponível. |
| Conectar com outro fluxo | Existe (tarefa 1.4) | Conectar com outro fluxo / `connect_flow` | Sem retorno; variáveis seguem; proteção contra loop. Ver [Conectar com outro fluxo](#conectar-com-outro-fluxo). |

Outros tipos existentes não pedidos: Início (`start`), Fim (`end`), IA (`ai`), Agendar horário (`schedule`).

## Recursos do editor

- **Ativar/desativar fluxo**: existe — checkbox "Fluxo ativo" no editor e interruptor direto na lista (`/fluxos`, só com `flows.manage`). Ativar valida o desenho salvo (400 com o motivo se inválido). Fluxo inativo não dispara nem aparece no chat; **conversas que já estão no meio dele continuam até o fim** (`onInbound` entrega a resposta ao run ativo sem olhar `isActive`).
- **Duplicar fluxo**: existe (`POST /flows/:id/duplicate` e em lote; cópia nasce inativa).
- **Duplicar bloco**: existe (tarefa 1.1) — botão no card, Ctrl/Cmd+D, menu de contexto. Sem ligações.
- **Copiar/colar blocos** entre fluxos: existe (Ctrl+C/V, `localStorage`).
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
| `business_hours` — expediente de Configurações → Horário (respeita "atendimento ativo"); `hours` opcional = horário próprio | sim/não | `is_true` / `is_false` |

- Texto: compara depois de `trim`, **sem diferenciar maiúsculas/minúsculas e acentos** (`fold`: NFD sem diacríticos + minúsculas). `caseSensitive: true` na regra compara exato.
- Número: aceita vírgula decimal (`10,5`, `1.234,56`) e ponto (`10.5`). Se qualquer lado não for número (inclusive vazio), a regra é **falsa** — também para `≠`.
- `value` aceita `{{variáveis}}` (comparar duas variáveis: `value = "{{outra}}"`).
- **Plugar operando novo** (ex.: horário de atendimento de um setor, tarefa futura): acrescentar em `ConditionOperand` e `CONDITION_OPERANDS` (shared, com o `kind` — os comparadores do kind passam a valer sozinhos), uma entrada em `OPERANDS` (`conditions.ts`) e, se precisar de banco/config, uma função preguiçosa em `RuleEnv` montada em `FlowEngineService.evaluate`. Os dados externos só são buscados quando alguma regra usa o operando (`once` memoiza por avaliação). Operando desconhecido é avaliado como falso.
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
- **Sem intervalo, a ordem de chegada não é garantida** quando há mídia: cada item entra na fila de envio (`wa-outbound`, concorrência 20) e um texto curto pode sair antes de uma imagem grande que ainda está subindo. Mesma situação de dois blocos seguidos. O padrão de 1 s nas mensagens novas reduz isso; envio sequencial por conversa fica para a tarefa da fila de envio.
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

