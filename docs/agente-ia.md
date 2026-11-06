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
| `knowledge` | base de conhecimento: única fonte de fatos |
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
| POST | `/ai/agents/:id/simulate` | `{messages: [{from: contact\|agent, text}], stageId?}` → `AgentTurn` |

## Ainda não (próximas fases, ver doc 22)

- consultar agenda/marcar horário, orçamento com link, lembrete ("me chama amanhã");
- exportar/importar fluxo com bloco de agente leva o `aiAgentId` do cliente de origem: no destino,
  escolha o agente de novo.
