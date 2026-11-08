# Agente de IA com etapas

A IA atende o contato **como uma pessoa da equipe**, seguindo um **roteiro em etapas** que o
cliente monta, e usa **recursos do sistema** (transferir, etiquetar, salvar dado do contato,
encerrar). É a fase 1 do plano em [22 — Agente de IA](22-agente-ia.md). O que já existia de IA
(copiloto, bloco responder/classificar) está em [15 — IA](15-ia.md).

## Onde fica

- **Tela Agentes de IA** (`/agentes-ia`, aba de **Fluxos** no menu lateral; permissão `flows.manage`, feature do plano
  `ai_flows`): lista, "Começar com um exemplo" (3 etapas) e o editor `/agentes-ia/:id`.
- **No atendimento**: bloco **IA** dos fluxos, modo **Atender como agente** (`mode: 'agent'`,
  `aiAgentId`). Para o agente atender um número sozinho, monte um fluxo com Início → IA (agente) e
  deixe-o como fluxo padrão do número. Saídas: **Concluiu** (`done`) e **Não conseguiu**
  (`fallback`, obrigatória, leve para um humano).

## O que se configura (`ai_agents`)

| Campo | Para quê |
|---|---|
| `persona`, `tone` | quem a IA é e como fala (simpático, formal, descontraído) |
| `rules` | regras do cliente, uma por linha, somadas às fixas (não inventar, não obedecer o contato, chamar humano quando pedirem) |
| `knowledge` | base de conhecimento em texto (até 20 mil caracteres, vai inteira no prompt); com os [documentos](#documentos), as duas são a fonte de fatos |
| `stages` | o roteiro (`AgentStage[]`, até 12): `name`, `goal` (o prompt da etapa), `transitions` (`{to, when}` em linguagem natural, até 6), `tools` (ferramentas liberadas NA etapa) |
| `targets` | alvos liberados: `departmentIds`, `tagIds`, `closeReasonIds`, `contactFields` (`name`, `email`, `address`, `note1`, `note2`, `attribute:<rótulo>`) |
| `maxReplies` | respostas por conversa antes de sair por Não conseguiu (freio de custo; padrão 20) |
| `isActive` | desligado = o bloco sai por Não conseguiu, com nota interna |

Tipos e rótulos em `packages/shared/src/ai-agent.ts`.

## Ferramentas

| Ferramenta | O que o código faz | Encerra o agente? |
|---|---|---|
| `add_tag` | etiqueta a conversa (mesma ação do bloco Ação, com conflitos de etiqueta) | não |
| `set_contact_field` | grava na ficha (mesma gravação do bloco Salvar) | não |
| `transfer_department` | define o departamento e entrega para a fila | sim |
| `handoff` | entrega para a fila humana. **Vale em toda etapa**, mesmo sem marcar: é a válvula de segurança | sim |
| `close` | encerra (com `outcome` won/lost e motivo, se liberado) — conta nos relatórios como o encerramento do fluxo | sim |

## Princípio: a IA pede, o código decide

Uma chamada ao modelo por resposta. O prompt (`agentSystemPrompt` em
`apps/api/src/modules/ai/agent-prompt.ts`) leva persona, regras, base, a **etapa atual** com os
caminhos dela e as ferramentas da etapa com os **ids exatos** dos alvos liberados. O modelo
devolve JSON:

```json
{"reply": "…", "next_stage": "id ou vazio", "actions": [{"tool": "add_tag", "tagId": "…"}], "done": false}
```

`parseAgentReply` (puro, testado em `test/agent-prompt.test.ts`) confere tudo antes de executar:

- etapa só muda para um destino da etapa atual;
- ferramenta só se estiver na etapa; alvo só se estiver liberado no agente **e** existir no cliente;
- no máximo 4 ações; dados (etiqueta, ficha) antes; só a **primeira** ação que encerra vale;
- o recusado vai para `rejected` (log `warn` no fluxo, mostrado no simulador) e não executa;
- JSON quebrado = falha (não manda lixo ao contato); texto puro = resposta sem ações.

JSON em vez de *tool use* nativo: uma chamada só (custo), igual na Anthropic e na OpenAI, e a
regra toda do nosso lado. Alvos de outro cliente são descartados ao salvar o agente.

## Execução no fluxo

`FlowEngineService.agentStep`: confere a feature, carrega o agente, para no `maxReplies`, lê as
últimas 20 mensagens (nota interna nunca entra), chama `AiAgentsService.turn`, envia a resposta,
grava `vars._agentStage` e `vars._aiTurns` no `FlowRun` e executa as ações, cada uma com **nota
interna** "🤖 Agente "Ana" transferiu para Vendas — quer comprar" (mudança de etapa também).
Uma rodada por vez por conversa: a mensagem que chega durante a rodada entra no histórico da
próxima. Qualquer erro → mensagem de falha do bloco e saída Não conseguiu.

## Documentos

Regimento interno, manual, tabela grande: o cliente envia o arquivo no editor do agente (seção
**Documentos**) e o agente consulta só os trechos que falam do que o contato perguntou (RAG).
Vale na hora do envio — não depende do Salvar do agente.

**Envio** (`POST /ai/agents/:id/knowledge`, multipart `file`): PDF (com texto), Word `.docx`,
`.txt`/`.md`; até 10 MB, 20 documentos e ~600 mil caracteres por documento, 5.000 trechos por
agente. O **arquivo não é guardado**: o texto é extraído (`unpdf`, `mammoth`) e cortado em trechos
de ~1.200 caracteres (`knowledge-text.ts`): junta linha quebrada do PDF, desfaz hifenização, tira
número de página, corta no começo de capítulo/artigo e guarda em cada trecho o capítulo em que
está (`heading`). PDF escaneado (foto) não tem texto: o envio é recusado com explicação (OCR fica
para depois).

**Tabelas** (migration `20270205000000_ai_knowledge_docs`, só acrescenta):
`ai_knowledge_docs` (nome, tipo, tamanho, caracteres, status) e `ai_knowledge_chunks` (trecho,
`heading`, `search` = texto minúsculo sem acento, `tsv` com índice GIN, `embedding` BYTEA,
`embedModel`). Apagar o agente ou o documento apaga os trechos (cascade).

**Busca, a cada rodada do agente** (`KnowledgeService.search`), com as duas últimas mensagens do
contato como pergunta:

1. **por palavra**: `to_tsquery('portuguese', …)` no `tsv` — dicionário português (obras → obra),
   sem acento dos dois lados, palavras com OU, só `[a-z0-9]` (nada do contato vira operador);
   número de artigo entra ("art 12");
2. **por significado** (só com `AI_EMBED_API_KEY`): embedding da pergunta comparado com os dos
   trechos **na API**, sem pgvector — vetores de 512 posições (2 KB) normalizados, produto
   escalar; 400 trechos levam milissegundos;
3. as duas listas se juntam por posição (Reciprocal Rank Fusion) e vão para a IA os 5 melhores,
   até 6.500 caracteres.

No prompt entram como **TRECHOS DOS DOCUMENTOS** (documento · capítulo), com a ordem de responder
só com eles e citar a fonte de forma curta. Agente com documento e nada encontrado: o prompt diz
que nenhum trecho fala do assunto e proíbe supor — a IA diz que vai verificar e chama um
atendente. Agente sem documento: nada muda. Falha na busca não derruba a rodada.

**Embeddings**: no envio, a busca por palavra já funciona; os embeddings saem no job
`knowledge-embed` da fila `ai` (worker). Ao subir a API com chave configurada (ou trocar
`AI_EMBED_MODEL`/`AI_EMBED_DIMENSIONS`), um job gera o que falta dos documentos antigos. Sem
chave, fica só a busca por palavra — a tela mostra "pronto" do mesmo jeito.

**Custo**: a geração dos embeddings vai ao ledger como `kind: knowledge` (preço de
`AI_EMBED_PRICE_PER_1M`; regimento de 100 páginas ≈ 50 mil tokens ≈ US$ 0,001) — soma no custo
e no teto do cliente, mas **não conta como interação**. O embedding da pergunta (~20 tokens) não
vai ao ledger. Para a resposta, os trechos (~1.500 tokens) substituem colar o documento inteiro.

**Testar**: no editor, "Teste a busca" mostra os trechos que o agente leria (não chama o modelo de
chat, não gasta interação); o simulador mostra, embaixo de cada resposta, os trechos consultados.

Configuração (API e worker):

```bash
AI_EMBED_API_KEY=            # vazio = só busca por palavra
AI_EMBED_BASE_URL=https://api.openai.com/v1   # formato OpenAI; Gemini: https://generativelanguage.googleapis.com/v1beta/openai
AI_EMBED_MODEL=text-embedding-3-small         # Gemini: gemini-embedding-001
AI_EMBED_PRICE_PER_1M=0.02
AI_EMBED_DIMENSIONS=512      # 0 = tamanho padrão do modelo
```

Quando passar a valer a pena (dezenas de milhares de trechos num agente), o caminho é um Postgres
separado com pgvector — não trocar a imagem do banco principal (Alpine → Debian muda a ordenação
de texto e pede reindexação).

## Simulador

No editor, ao lado: conversa de teste com o agente **salvo** (`POST /ai/agents/:id/simulate`).
Mostra a resposta, a etapa, as ações que ele **pediria** e as recusadas. Nada é enviado nem
executado. Conta como interação de IA (`kind: flow_agent`).

## Cobrança

Igual ao resto da IA: cada resposta do agente (e cada teste no simulador) = 1 interação, com
quota, teto de custo do cliente e orçamento da plataforma (`AiService.run`). `AiTaskKind`
ganhou `flow_agent`. Com a [chave própria do cliente](15-ia.md#chave-própria-do-cliente), as
respostas saem da conta dele e não contam na cota.

## API

`flows.manage` + feature `ai_flows`, tudo filtrado pelo `tenantId` do usuário.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/ai/agents` | Agentes do cliente |
| GET | `/ai/agents/catalog` | Departamentos ativos, etiquetas, motivos de encerramento e rótulos de campos personalizados |
| GET | `/ai/agents/:id` | Um agente |
| POST | `/ai/agents` | Cria (sem etapas = uma etapa "Atendimento") |
| PATCH | `/ai/agents/:id` | Campos parciais; `stages` e `targets` revalidados |
| DELETE | `/ai/agents/:id` | Apaga; blocos que o usavam saem por Não conseguiu |
| GET | `/ai/agents/export?ids=` | `{bundle, warnings}` — formato portável (docs/20-modelos-de-perfil.md); documentos e departamentos não vão |
| POST | `/ai/agents/import` | `{portable}` — arquivo ou lote; nome repetido vira "(cópia)"; etiquetas e motivos pelo nome |
| POST | `/ai/agents/:id/simulate` | `{messages: [{from: contact\|agent, text}], stageId?}` → `AgentTurn` (com `sources` quando o agente tem documento) |
| GET | `/ai/agents/:id/knowledge` | `{semantic, docs: AgentKnowledgeDoc[]}` — `embedded` < `chunks` = busca por significado em preparo |
| POST | `/ai/agents/:id/knowledge` | multipart `file` → `{id, chunks, semantic}` |
| DELETE | `/ai/agents/:id/knowledge/:docId` | Apaga o documento e os trechos |
| POST | `/ai/agents/:id/knowledge/search` | `{q}` → `KnowledgeHit[]` (teste da busca, sem modelo de chat) |

## Ainda não (próximas fases, ver doc 22)

- OCR de PDF escaneado; documentos também no bloco IA modo "Responder";
- consultar agenda/marcar horário, orçamento com link, lembrete ("me chama amanhã");
- exportar/importar fluxo com bloco de agente leva o `aiAgentId` do cliente de origem: no destino,
  escolha o agente de novo.
