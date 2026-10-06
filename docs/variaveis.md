# Variáveis `{{...}}` — fluxos, respostas rápidas, campanhas e chat

Um formato só, resolvido **na hora do envio** pela API. Vale em: textos dos fluxos (Conteúdo,
Menu, Perguntar, IA, webhook, Manipulador, condições), boas-vindas e resposta por faixa de
horário, campanhas, respostas rápidas, mensagens digitadas no chat e mensagens agendadas.

## Variáveis disponíveis

| Variável | Vira |
|---|---|
| `{{contact.name}}` | Nome do contato |
| `{{contact.first_name}}` | Primeiro nome ("Maria Clara Souza" → "Maria") |
| `{{contact.phone}}` `{{contact.email}}` `{{contact.address}}` `{{contact.note1}}` `{{contact.note2}}` | Campos fixos da ficha |
| `{{contact.<chave>}}` | Campo livre da ficha ([Campos personalizados](campos-personalizados.md)). Chave = nome do campo sem acento, minúsculo, com `_` no lugar de espaço/pontuação: "Placa do carro" → `{{contact.placa_do_carro}}`, "C.P.F." → `{{contact.c_p_f}}`. Contato sem o campo → vazio |
| `{{empresa}}` ou `{{company.name}}` | Nome da empresa (tenant) |
| `{{saudacao}}` ou `{{greeting}}` | "Bom dia" (05h–11h59), "Boa tarde" (12h–17h59), "Boa noite" (18h–04h59), **no fuso do cliente** (Configurações), na hora em que a mensagem sai |
| `{{agent.name}}` | Quem enviou (chat, resposta rápida, agendada) |
| `{{nome_da_variavel}}` | Variável criada no fluxo (Salvar, Menu, Manipulador, webhook) |
| `{{faixa}}` `{{proxima_abertura}}` | Só nas respostas automáticas de horário ([Horários](horarios.md)) |

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
| Catálogo (`SYSTEM_VARIABLES`), `attributeVarKey`, `greetingAt`, `firstName` — iguais no front e na API | `packages/shared/src/variables.ts` |
| Troca (pura): `interpolate(text, ctx, escape?, { keepUnknown? })` | `apps/api/src/modules/flows/answer.ts` |
| Monta o contexto (empresa, fuso, campos livres, atendente): `InterpolationService.context` / `forContact` | `apps/api/src/common/interpolation/interpolation.service.ts` (global, no `CoreModule`) |
| Chat: `ConversationsService.send` troca quando o texto tem `{{` | `apps/api/src/modules/conversations/conversations.service.ts` |
| Menu "Inserir variável" (sistema + **campos da ficha** já usados na empresa + do fluxo) | `apps/web/src/components/flows/TextWithVars.tsx` (`useAttributeVars`) |

O menu "Inserir variável" aparece no editor de fluxos, nas mensagens automáticas, no editor de
respostas rápidas (`/respostas`) e no modal de agendar mensagem. Os campos livres listados vêm
de `GET /contact-attributes/labels`.

**Nova variável global**: acrescentar em `SYSTEM_VARIABLES` (shared, para o menu) e em
`InterpolationService.context` (`globals`).

No chat, a resposta rápida já entra no campo com `{{contact.name}}` e `{{agent.name}}`
trocados pelo navegador; as demais (`{{saudacao}}`, campos da ficha…) aparecem cruas no campo
e são trocadas pela API no envio.
