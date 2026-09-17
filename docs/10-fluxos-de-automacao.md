# 10 — Fluxos de automação

## O que é

Atendimento automático desenhado pelo cliente num editor visual: o robô manda mensagens, oferece menus, faz perguntas, aplica tags e, quando precisa, **entrega para um humano**. Funcionalidade **plugável no plano** (`limits.features: ['flows']` — Pro e Business no seed).

Onde aparece:
- Menu **Fluxos** — lista e editor.
- No chat, painel direito, aba **Fluxos** — o atendente dispara um fluxo na conversa aberta.
- Cabeçalho da conversa em automação: faixa "🤖 Fluxo X está atendendo · **Parar e assumir**". Na lista, 🤖 antes do nome.

## Blocos

| Bloco | Faz | Saídas |
|---|---|---|
| **Início** | Ponto de partida (um por fluxo) | 1 |
| **Enviar mensagem** | Texto com variáveis `{{contact.name}}`, `{{contact.phone}}`, `{{minha_var}}` | 1 |
| **Perguntar** | Envia a pergunta, **espera a resposta** e guarda em `{{varName}}`. Validação: qualquer / e-mail / telefone / número. Resposta inválida → mensagem de erro e nova tentativa; estourou `maxRetries` → entrega para humano | 1 |
| **Menu de opções** | Envia texto + opções numeradas ("1 - Vendas"). Aceita número ou o texto da opção. Inválida → tentativa; estourou → saída *resposta inválida* (ou humano, se não ligada) | uma por opção + `fallback` |
| **Condição** | Variável igual/contém · conversa tem tag · dentro do horário comercial (fuso São Paulo) | `yes` / `no` |
| **Ação** | Aplicar/remover tag (na conversa ou 📌 no contato) · atribuir a atendente · mudar status · **entregar para humano** (encerra o fluxo; opcionalmente já atribui) | 1 (handoff: nenhuma) |
| **Aguardar** | Pausa de N minutos (job BullMQ com delay) | 1 |
| **Fim** | Encerra o fluxo; opcionalmente encerra a conversa | 0 |

Um bloco sem saída ligada termina o fluxo (`done`).

## Gatilhos

| Tipo | Quando dispara |
|---|---|
| **Manual** | Atendente clica *Iniciar* na aba Fluxos do chat |
| **Toda conversa nova** | Contato manda a primeira mensagem de uma conversa nova (opcionalmente só em alguns números) |
| **Palavra-chave** | Mensagem recebida contém uma das palavras (case-insensitive), se não houver fluxo ativo na conversa |

## Motor (`apps/api/src/modules/flows/flow-engine.service.ts`)

- `FlowRun` = uma execução numa conversa: `currentNodeId`, `vars`, `retries`, `status` (`running | waiting | done | stopped | failed`). No máximo um run ativo por conversa (`Conversation.activeFlowRunId`).
- `start()` cria o run no nó Início e chama `advance()`, que executa nós em sequência até um que **espere** (pergunta/menu → `waiting`; aguardar → `waiting` + job com delay) ou **termine**.
- Toda mensagem recebida passa por `onInbound()` (chamado pelo `InboundProcessor` logo após gravar a mensagem): run em `waiting` recebe a resposta (`deliverAnswer`) e continua; sem run, avalia os gatilhos.
- Mensagens do robô saem por `ConversationsService.sendAsSystem` — sem autor humano, **não assumem a conversa**, respeitam quota e janela de 24h e passam pela mesma fila de envio.
- Proteções: `MAX_STEPS = 50` por avanço (loop), erro em nó → `failed` com motivo, `stop()` pelo atendente → `stopped`.
- Enquanto um run está ativo o atendente continua vendo tudo e pode escrever; ao clicar **Parar e assumir** o robô para.

## Editor (`apps/web/src/components/flows/`)

React Flow (`@xyflow/react`). Paleta à esquerda (clique adiciona), canvas no meio (arrastar, ligar bolinhas, Delete remove), painel de propriedades à direita (muda conforme o bloco). Uma saída só liga a um destino (ligar de novo substitui). Barra superior: nome, gatilho/configurações, execuções (contagem por status + últimas 20), Salvar. "Alterações não salvas" compara o conteúdo com o último salvo.

Validação ao salvar (`flow-validation.ts`): exatamente um Início e conectado; conexões válidas; blocos de mensagem/pergunta/menu preenchidos.

## API

| Método | Rota | Role | Descrição |
|---|---|---|---|
| GET | `/flows` | todos* | Lista (com contagem de execuções) |
| GET | `/flows/:id` | todos* | Definição completa |
| POST / PATCH / DELETE | `/flows[/:id]` | admin, gerente | CRUD (valida a definição) |
| GET | `/flows/:id/runs` | todos* | `byStatus` + últimas execuções |
| POST | `/flows/:id/start` | todos* | `{conversationId}` — disparo manual |
| GET | `/conversations/:id/flow` | todos | Run ativo ou `null` |
| POST | `/conversations/:id/flow/stop` | todos | Para o run ativo |

\* exige `features: ['flows']` no plano (`FeatureGuard`) — 403 com mensagem "não está incluído no seu plano".

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

- Bloco *Enviar mensagem* ainda não anexa mídia pelo editor (o motor já suporta `mediaKey`).
- Sem "ir para outro fluxo" nem sub-fluxos.
- Sem teste/simulação dentro do editor (usar uma conversa de teste).
- Estatísticas por bloco (onde os contatos abandonam) — futuro.
