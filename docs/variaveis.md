# Variáveis `{{...}}` — fluxos, respostas rápidas, campanhas e chat

Um formato só, resolvido **na hora do envio** pela API. Vale em: textos dos fluxos (Conteúdo,
Menu, Perguntar, IA, webhook, Manipulador, condições), boas-vindas e resposta por faixa de
horário, campanhas, respostas rápidas, mensagens digitadas no chat e mensagens agendadas.

## Variáveis disponíveis

| Variável | Vira |
|---|---|
| `{{contact.name}}` | Nome do contato |
| `{{contact.first_name}}` | Primeiro nome ("Maria Clara Souza" → "Maria") |
| `{{contact.last_name}}` | Último sobrenome ("Tiago Lima de Melo" → "Melo"; nome único → ele mesmo) |
| `{{contact.phone}}` | Telefone só com números, com DDI (`5562999999999`). Legível: `{{contact.phone \| formatted}}` |
| `{{contact.email}}` `{{contact.address}}` `{{contact.note1}}` `{{contact.note2}}` | Campos fixos da ficha |
| `{{contact.<chave>}}` | Campo livre da ficha ([Campos personalizados](campos-personalizados.md)). Chave = nome do campo sem acento, minúsculo, com `_` no lugar de espaço/pontuação: "Placa do carro" → `{{contact.placa_do_carro}}`, "C.P.F." → `{{contact.c_p_f}}`. Contato sem o campo → vazio |
| `{{empresa}}` ou `{{company.name}}` | Nome da empresa (tenant) |
| `{{saudacao}}` ou `{{greeting}}` | "Bom dia" (05h–11h59), "Boa tarde" (12h–17h59), "Boa noite" (18h–04h59), **no fuso do cliente** (Configurações), na hora em que a mensagem sai |
| `{{agent.name}}` | Quem enviou (chat, resposta rápida, agendada) |
| `{{global.<chave>}}` ou `{{<chave>}}` | **Variável da empresa** (Configurações → Variáveis globais): valor fixo como chave PIX, horário, link do catálogo. Ver abaixo |
| `{{nome_da_variavel}}` | Variável criada no fluxo (Salvar, Menu, Manipulador, webhook) |
| `{{faixa}}` `{{proxima_abertura}}` | Só nas respostas automáticas de horário ([Horários](horarios.md)) |

## Variáveis da empresa (globais customizadas)

Cadastradas pela empresa em **Configurações → Variáveis globais** (tabela com busca, criar,
editar, excluir) ou direto no menu "Inserir variável" de qualquer tela (fluxos, mensagens
automáticas, respostas rápidas, agendamento, botão `{ }` do chat): grupo **Variáveis da
empresa** → **+ Criar nova variável global** abre um mini-formulário ali mesmo (Nome, Chave —
preenchida sozinha a partir do nome, em snake_case —, Valor). Salvou, `{{chave}}` entra no
texto onde estava o cursor e a lista atualiza no sistema todo.

- Tabela `global_variables`: `key` única por empresa, `label`, `value`. Até 200 por empresa.
- Chave: minúsculas sem acento, números e `_`, começando por letra, até 40 (`globalVarKey` /
  `globalVarKeyError`). Reservadas (recusadas): `empresa`, `saudacao`, `greeting`, `faixa`,
  `proxima_abertura`, `agendamento`, `servico`, `profissional`, `global`, `contact`, `agent`,
  `company`.
- No envio valem `{{global.pix_chave}}` (sempre) e `{{pix_chave}}`. Sem prefixo, **variável do
  fluxo de mesmo nome vence** (regra de sempre); com `global.` é sempre a da empresa. O menu
  insere a forma curta.
- Filtros e padrão valem igual: `{{pix_chave | upper}}`, `{{horario | default: '08h às 18h'}}`.
- Mudou o valor, vale no próximo envio (é lido a cada mensagem — nada fica salvo no texto).
  Excluiu: fluxo/campanha/automático enviam vazio; no chat fica como foi escrito.
- Listar: todos da equipe (os menus precisam). Criar: `variables.manage` **ou** `flows.manage`
  (o "+ Criar nova variável global" aparece para os dois). Editar/excluir (tela em
  Configurações): só `variables.manage` (padrão: Administrador e Gerente) —
  [Perfis de acesso](18-perfis-de-acesso.md).
- API: `GET/POST /tenants/me/global-variables`, `PUT/DELETE …/:id` ([API](07-api.md)).

## Filtros e valor padrão

Dentro das chaves, depois do nome, filtros separados por `|`, aplicados **em ordem** (vale
para qualquer variável: contato, campo da ficha, globais, variáveis do fluxo):

| Filtro | Exemplo | Resultado |
|---|---|---|
| `first` | `{{contact.name \| first}}` | "Tiago" (igual a `{{contact.first_name}}`) |
| `last` | `{{contact.name \| last}}` | "Melo" (igual a `{{contact.last_name}}`) |
| `title` | `{{contact.name \| title}}` | "TIAGO LIMA DE MELO" → "Tiago Lima de Melo" (de/da/do/dos/das/e ficam minúsculas no meio) |
| `upper` | `{{contact.name \| first \| upper}}` | "TIAGO" |
| `lower` | `{{contact.name \| lower}}` | "tiago lima de melo" |
| `formatted` | `{{contact.phone \| formatted}}` | "(62) 99999-9999" / fixo "(62) 3333-4444"; outro país "+351912345678"; texto com letra fica como está |
| `trim` | `{{resposta \| trim}}` | sem espaços nas pontas |
| `default: 'X'` | `{{contact.name \| default: 'Cliente'}}` | "Cliente" quando o valor está vazio/só espaços ou a variável não existe |

`{{contact.first_name || 'Cliente'}}` é atalho de `| default: 'Cliente'`. O valor padrão
aceita aspas simples, duplas, as "curvas" do celular ou nenhuma (`|| Cliente`, até o próximo
`|`). Ordem importa: `{{contact.first_name || 'cliente' | upper}}` → "CLIENTE";
`{{contact.first_name | upper || 'cliente'}}` → "cliente".

- Filtro com nome desconhecido é **ignorado** (o valor passa como está).
- Sintaxe inválida (aspas sem fechar, `|` sem filtro, espaço no nome) → o `{{...}}` **fica
  como foi escrito**, em qualquer canal.
- Chave desconhecida **com** valor padrão vira o padrão (também no chat).
- O `escape` do webhook (JSON/URL) vale também para o valor padrão.

Regras:

- **Variável do fluxo vence a global de mesmo nome** (um fluxo antigo com `{{empresa}}` salvo
  pelo bloco Salvar continua mostrando o que salvou).
- Campo livre não sobrescreve campo fixo: um campo chamado "Name" não muda `{{contact.name}}`.
  Dois campos que geram a mesma chave no mesmo contato: vale o primeiro da ficha.
- Chave desconhecida: em fluxo/campanha/automático vira **vazio** (comportamento antigo); em
  mensagem do chat (digitada, resposta rápida, agendada) **fica como foi escrita** — o
  atendente pode ter digitado `{{` de propósito.
- Mensagem encaminhada e template da Meta não passam pela troca.

## Onde está o código

| Peça | Arquivo |
|---|---|
| Catálogo (`SYSTEM_VARIABLES`, `VARIABLE_SHORTCUTS`), `attributeVarKey`, `greetingAt`, `firstName`/`lastName`/`titleCase`/`formatPhone`, filtros (`VARIABLE_FILTERS`, `parseVariableExpr`, `applyVariableFilters`) — iguais no front e na API | `packages/shared/src/variables.ts` |
| Troca (pura): `interpolate(text, ctx, escape?, { keepUnknown? })` | `apps/api/src/modules/flows/answer.ts` |
| Testes | `apps/api/test/interpolation.test.ts` (filtros/padrão), `apps/api/test/variables.test.ts`, `apps/api/test/global-variables.test.ts` |
| Monta o contexto (empresa, fuso, campos livres, atendente, variáveis da empresa): `InterpolationService.context` / `forContact` | `apps/api/src/common/interpolation/interpolation.service.ts` (global, no `CoreModule`) |
| Chat: `ConversationsService.send` troca quando o texto tem `{{` | `apps/api/src/modules/conversations/conversations.service.ts` |
| Menu "Inserir variável" (**Mais usadas** + **variáveis da empresa** + sistema + **campos da ficha** já usados na empresa + do fluxo; rodapé com a sintaxe dos filtros) | `apps/web/src/components/flows/TextWithVars.tsx` (`useAttributeVars`, `SHORTCUT_VARS`, `VarSyntaxHint`) |
| Botão `{ }` da barra do chat ("Mais usadas" + variáveis da empresa) | `apps/web/src/components/chat/ComposerBar.tsx` |
| Variáveis da empresa: API (CRUD) | `apps/api/src/modules/global-variables/global-variables.module.ts` |
| Variáveis da empresa: grupo do menu + criação rápida (`GlobalVarsMenuSection`, `GlobalVariableForm`), tela em Configurações | `apps/web/src/components/variables/GlobalVariables.tsx`, `apps/web/src/components/settings/GlobalVariablesSection.tsx` |

O menu "Inserir variável" abre com o grupo **Mais usadas** (`VARIABLE_SHORTCUTS`): Primeiro
nome do cliente (`{{contact.first_name}}`), Nome completo (`{{contact.name}}`), Nome da
empresa (`{{company.name}}`) e Saudação por horário (`{{greeting}}`). `{{empresa}}` e
`{{saudacao}}` seguem valendo (apelidos), só não aparecem repetidas no menu. O menu
aparece no editor de fluxos, nas mensagens automáticas, no editor de
respostas rápidas (`/respostas`) e no modal de agendar mensagem; na barra do chat, o botão `{ }` insere as "Mais usadas" no campo
(a API troca no envio). Os campos livres listados vêm
de `GET /contact-attributes/labels`.

**Nova variável global do sistema** (não confundir com as da empresa, que o cliente cadastra): acrescentar em `SYSTEM_VARIABLES` (shared, para o menu) e em
`InterpolationService.context` (`globals`).

No chat, a resposta rápida já entra no campo com `{{contact.name}}` e `{{agent.name}}` (só a
forma exata, sem filtro) trocados pelo navegador; as demais (inclusive com filtro) (`{{saudacao}}`, campos da ficha…) aparecem cruas no campo
e são trocadas pela API no envio.
