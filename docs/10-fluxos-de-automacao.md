# 10 — Fluxos de automação

## O que é

Atendimento automático desenhado pelo cliente num editor visual: o robô manda mensagens, oferece menus, faz perguntas, aplica tags e, quando precisa, **entrega para um humano**. Funcionalidade **plugável no plano** (`limits.features: ['flows']` — Pro e Business no seed).

Onde aparece:
- Menu **Fluxos** — lista e editor.
- No chat, painel direito, aba **Fluxos** — o atendente dispara um fluxo na conversa aberta.
- Cabeçalho da conversa em automação: faixa "🤖 Fluxo X está atendendo · **Parar e assumir**". Na lista, 🤖 antes do nome.

## Blocos

A paleta agrupa os blocos em três categorias, e a cor do card é a da categoria — dá para ler
o desenho de longe: roxo = estrutura, amarelo/laranja = decisão, azul = entrega.

| Categoria | Bloco (`type`) | Faz | Saídas |
|---|---|---|---|
| — | **Início** (`start`) | Ponto de partida (um por fluxo; não pode ser apagado nem copiado) | 1 |
| Estrutura e Conteúdo | **Conteúdo** (`message`) | **Várias mensagens em sequência**, reordenáveis: texto (variáveis + *negrito* _itálico_ ~tachado~), imagem/vídeo/documento com legenda, áudio gravado (PTT) ou como arquivo. Intervalo opcional entre elas (segundos). Detalhes em [fluxos.md](fluxos.md#conteúdo) | 1 |
| Estrutura e Conteúdo | **Menu** (`menu`) | Envia as opções como **botões/lista** (Meta) ou texto numerado (Evolution). Aceita toque no botão, número (`2`, `2.`, `2)`) ou texto da opção, **sem diferenciar maiúsculas e acentos**. Inválida → mensagem + nova tentativa; estourou → saída *Tentativas esgotadas* (ou humano, se não ligada). **Tempo limite** opcional → saída *Não respondeu*. Detalhes em [fluxos.md](fluxos.md#menu) | uma por opção + `fallback` (tentativas esgotadas) + `timeout` (com tempo limite) |
| Estrutura e Conteúdo | **Manipulador** (`variable`) | Operações sobre variáveis do fluxo, em ordem (a segunda já vê o resultado da primeira): definir, somar, subtrair, acrescentar texto, limpar, copiar de outra variável (ou dado do contato), data/hora atual (no fuso do cliente). Valores aceitam `{{…}}`. Antes chamado *Variável global* | 1 |
| Estrutura e Conteúdo | **Conectar com outro fluxo** (`connect_flow`) | Termina este fluxo e começa outro (mesma empresa) do início, levando as variáveis. Sem retorno. Destino excluído/desativado ou loop → para e fica com o atendente atribuído (ou vai para a fila). Detalhes em [fluxos.md](fluxos.md#conectar-com-outro-fluxo) | 0 |
| Estrutura e Conteúdo | **Fim** (`end`) | Encerra o fluxo; opcionalmente encerra a conversa | 0 |
| Lógica e Decisão | **Ação** (`action`) | Aplicar/remover etiqueta (na conversa ou 📌 no contato) · atribuir a atendente · mudar status · **encerrar conversa** · **chamar webhook** (método, headers, corpo com variáveis, tempo limite, resposta em variável) · **transferir para atendente humano** (encerra o fluxo). `set_var` (Definir variável) continua funcionando nos fluxos antigos, mas só aparece no seletor de quem já usa. Detalhes em [fluxos.md](fluxos.md#ação) | 1 (handoff: nenhuma; webhook: normal + `error`) |
| Lógica e Decisão | **Randomizador** (`randomizer`) | Sorteia um ramo pelo peso (teste A/B). Percentual = peso ÷ soma dos pesos; peso 0 nunca sai | uma por ramo |
| Lógica e Decisão | **Condição** (`condition`) | **Ramos** avaliados em ordem, cada um com regras combinadas por **E/OU**; o primeiro verdadeiro define a saída. Operandos: variável do fluxo, campo do contato, mensagem recebida, data/hora atual, etiqueta, horário comercial. Detalhes em [fluxos.md](fluxos.md#condição) | uma por ramo (id do ramo) + `no` (**Senão**) |
| Lógica e Decisão | **Atraso inteligente** (`wait`) | Espera X minutos/horas/dias (job persistente). Com *só no horário de atendimento*, se o prazo vencer fora do horário (quadro do número), espera até a próxima abertura. Ou **até o próximo horário de atendimento**. Robô pausado / conversa encerrada antes do fim → o fluxo para | 1 |
| Lógica e Decisão | **IA** (`ai`) | Responde o contato com as instruções e a base de conhecimento do cliente, ou classifica a mensagem. Exige feature `ai_flows` (ver [15](15-ia.md)) | `done` / um por rótulo, + `fallback` (**obrigatório**) |
| Distribuição e Envio | **Salvar** (`question`) | Pergunta (opcional) e **espera a resposta**, guardando em `{{varName}}` e, se escolhido, num **campo da ficha do contato** (nome, e-mail, endereço, observações). Validação: qualquer / e-mail / telefone / número; estourou `maxRetries` → saída *Tentativas esgotadas* (ou humano, se não ligada). **Tempo limite** opcional → saída *Não respondeu* (não ligada: o fluxo termina) | 1 + `fallback` (+ `timeout` com tempo limite) |
| Distribuição e Envio | **Distribuidor** (`distributor`) | Entrega a conversa: **rodízio**, **menos ocupado** (menos conversas abertas) ou **fila** ("Aguardando"). Atendentes escolhidos no bloco ou todos os ativos — sempre só quem opera o número da conversa. **Departamento** opcional: a conversa entra nele e só os participantes concorrem ([Departamentos](departamentos.md)) | `done` / `fallback` (ninguém disponível) |
| Distribuição e Envio | **Agendar horário** (`schedule`) | Serviço → profissional → horário → confirma (ver [13](13-agendamento.md)). Exige feature `scheduling` | `done` / `fallback` |

Um bloco sem saída ligada termina o fluxo (`done`). Os nomes antigos (*Enviar mensagem*,
*Perguntar*, *Aguardar*) mudaram só na tela: o `type` salvo é o mesmo, fluxos existentes não
precisam de migração.

**Rodízio sem tabela nova**: cada distribuição grava um evento `transferred` com
`reason = 'distribuído pelo fluxo'` (`distribution.ts`); o próximo da vez é o seguinte, em ordem
de id, a quem recebeu o último desses eventos. O mesmo evento alimenta o relatório por atendente.

**Webhook** (`webhook.ts`): método GET/POST/PUT/PATCH/DELETE (padrão POST), headers e corpo com
`{{variáveis}}`; corpo vazio = JSON `{ event, flowId, conversationId, contact, vars }` (variáveis
internas `_*` não vão). Só http/https nas portas 80/443, sem usuário/senha na URL, **nenhum IP
privado/loopback/link-local** (conferido após o DNS), sem seguir redirecionamento e sem header
`Host` escolhido pelo cliente — a URL é digitada pelo cliente e o servidor não pode virar ponte
para a rede interna. Tempo limite 1–30 s (padrão 8). Falha não para o fluxo: sai por **Erro** se
ligada, senão pela saída normal (a variável de resposta fica vazia). Ver [fluxos.md](fluxos.md#ação).

## Variáveis

- **Do sistema**: `{{contact.name}}` (nome no WhatsApp), `{{contact.first_name}}`, `{{contact.phone}}`, `{{contact.email}}`, `{{contact.address}}`, `{{contact.note1}}`, `{{contact.note2}}` (da ficha), `{{empresa}}`/`{{company.name}}`, `{{saudacao}}`/`{{greeting}}` (Bom dia/Boa tarde/Boa noite no fuso do cliente).
- **Campos da ficha**: `{{contact.<chave>}}` de cada campo livre ("Placa do carro" → `{{contact.placa_do_carro}}`). Referência completa em [Variáveis](variaveis.md).
- **Criadas no fluxo**: o bloco **Salvar** cria uma (a resposta do contato fica nela); o **Menu** guarda a opção escolhida em `{{menu_<id>}}`; o bloco **Manipulador** grava/opera valores (`Olá {{contact.name}}`, contador +1, data de agora); o webhook pode guardar a resposta.
- Todo campo de texto do editor tem o botão **Inserir variável**, que lista as do sistema e as criadas no fluxo e insere `{{…}}` no cursor. A lista completa fica nas configurações do fluxo (botão *Gatilho*). Ela é atualizada na hora: criou a variável num bloco, já aparece nos outros.
- A **Condição** escolhe o campo do contato num seletor e a variável por texto com sugestões das criadas no fluxo.
- **Escopo**: as variáveis do fluxo vivem na execução (`FlowRun.vars`) — ver [fluxos.md](fluxos.md#variáveis-escopo-e-persistência).

## Gatilhos

| Tipo | Quando dispara |
|---|---|
| **Manual** | Atendente clica *Iniciar* na aba Fluxos do chat |
| **Toda conversa nova** | Contato manda a primeira mensagem de uma conversa nova (opcionalmente só em alguns números) |
| **Palavra-chave** | Mensagem recebida contém uma das palavras (case-insensitive), se não houver fluxo ativo na conversa |

## Motor (`apps/api/src/modules/flows/flow-engine.service.ts`)

- `FlowRun` = uma execução numa conversa: `currentNodeId`, `vars`, `retries`, `status` (`running | waiting | done | stopped | failed`). No máximo um run ativo por conversa (`Conversation.activeFlowRunId`).
- `start()` cria o run no nó Início e chama `advance()`, que executa nós em sequência até um que **espere** (salvar/menu → `waiting`, com tempo limite também `waitUntil` + job `reply-timeout`; atraso → `waiting` + job `resume` até `waitUntil`) ou **termine**.
- Toda mensagem recebida passa por `onInbound()` (chamado pelo `InboundProcessor` logo após gravar a mensagem): run em `waiting` recebe a resposta (`deliverAnswer`) e continua; sem run, avalia os gatilhos.
- Mensagens do robô saem por `ConversationsService.sendAsSystem` — sem autor humano, **não assumem a conversa**, respeitam quota e janela de 24h e passam pela mesma fila de envio.
- Proteções: `MAX_STEPS = 50` por avanço (loop), erro em nó → `failed` com motivo, `stop()` pelo atendente → `stopped`.
- Enquanto um run está ativo o atendente continua vendo tudo e pode escrever; ao clicar **Parar e assumir** o robô para.

## Editor (`apps/web/src/components/flows/`)

React Flow (`@xyflow/react`). Paleta à esquerda em três categorias (clique adiciona à direita do último; **arrastar e soltar** posiciona onde soltou), canvas no meio, painel de propriedades à direita. Barra superior: nome, **Organizar automaticamente**, gatilho/configurações, execuções (contagem por status + últimas 20), Salvar. "Alterações não salvas" compara o conteúdo com o último salvo.

- **Fluxo horizontal**: entrada à **esquerda**, saída(s) à **direita**. Card com várias saídas (Menu, Condição, Randomizador, Distribuidor, IA, Agendar) tem uma linha por saída, com a bolinha alinhada à linha. Ligações em curva (bezier) com seta. Uma saída só liga a um destino (ligar de novo substitui).
- **Fluxos antigos** (desenhados na vertical) abrem como estavam — posição salva nunca muda sozinha. Se a maioria das ligações desce, aparece a sugestão de **Organizar automaticamente** (`layout.ts`: coluna = distância até o Início por busca em largura, para laços não empurrarem o desenho; dentro da coluna, altura média dos pais na ordem das saídas). Organizar só vale depois de salvar.
- **Cortar ligação**: passar o mouse ou selecionar mostra uma **tesoura** no meio da ligação (`DeletableEdge.tsx`); Delete/Backspace remove a selecionada. Os dois caminhos passam por `onEdgesChange`, então o fluxo fica "não salvo" e a remoção vai no próximo Salvar.
- **Seleção múltipla**: Shift + clique (ou Ctrl/Cmd + clique) e Shift + arrastar no fundo.
- **Copiar / colar cards**: Ctrl/Cmd+C e Ctrl/Cmd+V, ou botão direito (Copiar / Colar aqui / Excluir). A área de transferência fica no `localStorage`, então cola em **outro fluxo aberto** (outra aba ou depois de navegar). Colar usa `cloneFlowFragment` (`packages/shared/src/flows.ts`): ids novos, só as ligações **entre** os cards copiados, `{{menu_<id>}}` reescrito para o card novo, Início nunca copiado. Posição: abaixo dos originais (mesmo fluxo), no centro da tela (outro fluxo) ou no ponto clicado (menu), descendo até não encostar em nenhum card.
- **Duplicar bloco**: botão de cópia no cabeçalho do card (aparece ao passar o mouse ou com o card selecionado), **Ctrl/Cmd+D** nos selecionados ou *Duplicar* no botão direito. Mesma configuração (via `cloneFlowFragment`), id novo, **sem ligações**, logo abaixo do original e descendo até não encostar em nenhum card. Início não duplica. O card chama o editor pelo contexto `FlowNodeActions` (`nodes.tsx`).
- Card com a faixa amarela **Reconfigurar: …** veio de outro cliente sem uma referência (ver *Replicar*); editar o bloco tira a faixa.

Validação ao salvar (`flow-validation.ts`): exatamente um Início e conectado; conexões válidas; Conteúdo com cada mensagem preenchida, anexo dentro do formato/tamanho do WhatsApp e intervalo de 0 a 300 s; Conectar com destino escolhido; Salvar com variável; Menu com texto e opção; tempo limite do Salvar/Menu de 0 a 30 dias; Manipulador com ao menos uma variável (e origem em *copiar*); Condição com regras completas em todo ramo (formato antigo também é validado, após a conversão); Randomizador com 2+ ramos e algum peso; webhook com URL http(s) (exceto card marcado para reconfigurar), método válido, tempo limite de 1 a 30 s e nomes de header válidos.

## API

| Método | Rota | Role | Descrição |
|---|---|---|---|
| GET | `/flows` | todos* | Lista (com contagem de execuções) |
| GET | `/flows/:id` | todos* | Definição completa |
| POST / PATCH / DELETE | `/flows[/:id]` | admin, gerente | CRUD (valida a definição). `PATCH {isActive: true}` sem `definition` valida o desenho **salvo** — ativar pela lista não liga fluxo quebrado. `PATCH` com `version` diferente da do banco → 409 `flow_version_conflict` ([controle de versão](fluxos.md#controle-de-versão-ao-salvar)); toda escrita incrementa `version` |
| POST | `/flows/:id/duplicate` | admin, gerente | Cópia no mesmo cliente (legado; a tela usa o lote) |
| POST | `/flows/duplicate` | admin, gerente | `{ids}` → `{flows}` — cópias em lote |
| POST | `/flows/delete` | admin, gerente | `{ids}` → `{deleted}` — exclusão em lote, tudo ou nada (id de outro cliente recusa o lote); execuções saem junto |
| POST | `/flows/active` | admin, gerente | `{ids, isActive}` → `{updated, failed[{id,name,reason}]}` — ativar/desativar em lote; ativar valida cada desenho e os inválidos ficam como estavam |
| GET | `/flows/:id/export` | admin, gerente | `{portable, warnings}` para outro cliente |
| POST | `/flows/export` | admin, gerente | `{ids}` → `{bundle, warnings}` — vários num arquivo |
| POST | `/flows/import` | admin, gerente | `{portable}` (individual **ou** lote) → `{flows, flow, warnings}` |
| GET | `/flows/:id/runs` | todos* | `byStatus` + últimas execuções |
| POST | `/flows/:id/start` | todos* | `{conversationId, resumeBot?}` — disparo manual. Robô pausado: 409 `bot_paused`; com `resumeBot: true` retoma o robô e inicia. Antes de criar o run confere o que faria o 1º envio falhar: encerrada, desconectado ou descadastrado = 400; contato frio no QR gasta 1 das 10 vagas do dia (sem vaga = 409 `cold_quota_exhausted`); frio no oficial = 400 ([Envio frio](envio.md#envio-frio)). Se o run falhar já nos primeiros passos, responde 400 `flow_failed` com o motivo (a tela não mostra "Fluxo disparado") |
| GET | `/conversations/:id/flow` | todos | Run ativo ou `null` |
| POST | `/conversations/:id/flow/stop` | todos | Para o run ativo |
| POST | `/conversations/:id/bot/pause` · `/bot/resume` | todos (feature `flows`) | Pausa/retoma o robô só na conversa ([fluxos.md](fluxos.md#pausar-o-robô-na-conversa)) |

\* exige `features: ['flows']` no plano (`FeatureGuard`) — 403 com mensagem "não está incluído no seu plano".

## Atalho no chat

Cada fluxo tem `showInChat`, que decide se ele aparece na aba **Fluxos** do chat para o
atendente disparar na conversa aberta. A aba listava todos os fluxos ativos, e fluxo que roda
sozinho (gatilho `new_conversation` ou `keyword`) só virava ruído ali.

O padrão de um fluxo **novo** segue o gatilho: manual entra como atalho, automático não. Os
fluxos que já existiam continuam aparecendo — mudar isso retroativamente faria sumir da tela
um atalho que alguém usava.

Dá para alternar no editor (*Atalho no chat*) ou direto na lista de Fluxos, pelo ícone de
alfinete.

## Replicar um fluxo

Duas operações diferentes de propósito, porque o risco é diferente.

**Duplicar** (`POST /flows/duplicate`, um ou vários selecionados na listagem) copia dentro do **mesmo** cliente. Cópia literal:
etiquetas, atendentes e anexos continuam válidos. O nome ganha " (cópia)", numerando a partir
da segunda.

**Exportar / Importar** leva o fluxo para **outro** cliente, e aí o JSON cru não serve. O
`definition` guarda referências locais — `tagId`, `agentId`, `serviceId`, `mediaKey` — que no
destino não existem. A da mídia é a mais perigosa: a chave é `media/<tenantId>/arquivo`, então
um fluxo copiado cru faria o cliente de destino **servir arquivo do cliente de origem**.

O módulo único `packages/shared/src/portable.ts` (`scrubFlowDefinition` / `flowToPortable` na
saída, `restoreFlowDefinition` / `flowFromPortable` na entrada) resolve assim — e é o mesmo
usado pelo editor ao colar cards vindos de outra empresa:

| Referência | No arquivo exportado |
|---|---|
| `tagId` | vira `tagName` — o nome é único por cliente (`@@unique([tenantId, name])`) |
| `agentId` | removido, com aviso |
| `agentIds` (Distribuidor) | removido, com aviso (no destino distribui entre todos) |
| `departmentId` (Distribuidor, Ação "Definir departamento") | removido, com aviso e *Reconfigurar* |
| `url` do webhook | removida, com aviso — costuma levar token na query |
| `headers` do webhook | os de credencial (`Authorization`, `X-Api-Key`, nome com `token`/`secret`) saem inteiros, com aviso; os demais ficam |
| `body` do webhook | viaja; a tela avisa antes de baixar ("Este arquivo contém o corpo de webhooks…") |

Na importação, todo webhook chega marcado **Reconfigurar: revisar configuração**.
| `serviceId` / `professionalId` | removidos, com aviso (o fluxo passa a perguntar) |
| `mediaKey` / `mediaType` / `mediaName` | removidos, com aviso (também o `mediaKey` de cada mensagem em `items`) |
| `flowId` (Conectar com outro fluxo) | removido, com aviso; o nome do destino fica em `flowName` só para o card mostrar "Era: …" |
| `trigger.numberIds` | removido, com aviso |

Cada remoção também marca o card com `data._reconfig` (ex.: `["anexo"]`), que o editor mostra
como a faixa **Reconfigurar** e apaga quando o bloco é editado. O motor ignora o campo.

**Lote**: a listagem tem checkbox por fluxo e "selecionar todos"; *Exportar selecionados* gera
um arquivo `{ atendo: 'flow-bundle', version: 1, items: PortableFlow[] }` — cada item é
exatamente o que a exportação individual gera. `parsePortableFlowFile` aceita os dois formatos; a
importação é **tudo ou nada** (um item inválido recusa o arquivo antes de criar qualquer fluxo) e
nome repetido ganha " (cópia)". Na **importação** todos os nós (inclusive o Início) e ligações
ganham **ids novos** (`renewFlowIds`, que reescreve `{{menu_<id>}}`); na duplicação no mesmo
cliente os ids dos nós são mantidos. O fluxo em si sempre ganha id novo. A listagem também
**ativa/desativa**, **duplica** e **exclui** em lote. Excluir pede para digitar **EXCLUIR**
(`ConfirmDialog` com `typeToConfirm`) — com "selecionar todos" marcado, um clique apagaria o
cliente inteiro de automação.

**Copiar para outra empresa**: não existe — cada usuário pertence a um único cliente
(`User.tenantId`). Para levar a outro cliente, exporte e importe (o super admin faz isso
entrando como cada cliente). Copiar/colar cards entre empresas no mesmo navegador (super admin)
passa pela mesma limpeza — ver [fluxos.md](fluxos.md#exportação-importação-e-cópia).

Na importação as etiquetas citadas são **criadas se faltarem**: sem isso o fluxo chegaria com
os blocos de etiqueta vazios — pior que falhar, porque parece que funcionou.

Todo fluxo duplicado ou importado nasce **desativado**, e `parsePortableFlow` desconfia do arquivo
(ele pode ter sido editado à mão entre exportar e importar).

Os avisos vão para a tela: um fluxo que chega mudo no destino é pior do que um que chega
dizendo o que falta ajustar.

## Exemplo de definição

```json
{ "nodes": [
  { "id": "s", "type": "start", "position": {"x":0,"y":0}, "data": {} },
  { "id": "menu", "type": "menu", "position": {"x":0,"y":120}, "data": { "text": "Como posso ajudar?", "options": [{"id":"o1","label":"Vendas"},{"id":"o2","label":"Suporte"}], "maxRetries": 1 } },
  { "id": "q", "type": "question", "position": {"x":0,"y":240}, "data": { "text": "Qual o seu e-mail?", "varName": "email", "validation": "email", "maxRetries": 2 } },
  { "id": "h", "type": "action", "position": {"x":0,"y":360}, "data": { "kind": "handoff" } }
], "edges": [
  { "id": "e1", "source": "s", "target": "menu" },
  { "id": "e2", "source": "menu", "sourceHandle": "o1", "target": "q" },
  { "id": "e3", "source": "q", "target": "h" }
] }
```

## Limitações atuais / próximos passos

- "Conectar com outro fluxo" existe, mas sem retorno (não é sub-fluxo).
- Sem teste/simulação dentro do editor (usar uma conversa de teste).
- Estatísticas por bloco (onde os contatos abandonam) — futuro.


## Condição "dentro do horário de atendimento" e "faixa de horário atual"

Usam o **quadro de horários do número da conversa** (Configurações → Horários de atendimento,
ver [Horários](horarios.md)), inclusive a chave *Desativar atendimento*. Regra antiga com
horário próprio no bloco continua valendo, no **fuso do cliente**.


## Fluxos padrão do cliente

Configurados uma vez em **Configurações → Fluxos padrão** e válidos para todos os números,
sem precisar criar gatilho em cada fluxo. Rodam **depois** dos gatilhos próprios: uma
palavra-chave configurada sempre ganha do padrão.

| Fluxo padrão | Quando dispara |
|---|---|
| **Boas-vindas** | primeira mensagem de um contato que nunca conversou |
| **Conversa finalizada** | contato volta a escrever depois de o atendimento ter sido encerrado |
| **Resposta padrão** | qualquer mensagem que não casou com palavra-chave, **e só após o período de inatividade** (padrão 24h) |
| **Ao encerrar o atendimento** (`onCloseFlowId`) | toda vez que um atendente encerra |
| **Ao encerrar — Comprou / Não comprou / Sem resultado** (`wonFlowId`, `lostFlowId`, `noneFlowId`) | encerramento com aquele resultado; ganha do "ao encerrar" geral |

No modal de encerramento, escolher o resultado já pré-seleciona o fluxo dele (ou o geral); o
atendente encerra com um clique ou troca/põe *Nenhum* só para aquele atendimento. Na API,
`flowId` ausente = servidor aplica o padrão; `flowId: null` = nenhum fluxo.

O período de inatividade da resposta padrão existe para o robô **não falar por cima do
atendente**: sem ele, cada mensagem de uma conversa em andamento dispararia o fluxo. `0`
responde sempre.

Antes disso tudo vale a **faixa de horário** do quadro do número: boas-vindas, mensagem (ou
fluxo) da faixa — ex.: Fechado — **uma vez por conversa a cada período**, e se o atendimento
segue ou para. O antigo *aviso de fora do expediente* virou a mensagem da faixa Fechado com
"enviar só se nenhum fluxo responder". Ver [Horários](horarios.md).
