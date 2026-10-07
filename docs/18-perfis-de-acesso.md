# 18 — Perfis de acesso

## O problema

O papel (`Role`) era a única fonte de autorização: `agent`, `manager`, `tenant_admin`,
`super_admin`. Um enum fechado não cobre a realidade dos clientes — uma farmácia tem três
gerentes no mesmo nível, outra não tem gerente nenhum e precisa de um **atendente líder**
que enxerga a equipe sem mexer na conta.

## O desenho

O papel continua existindo, mas decide só duas coisas:

1. quem é o **dono do sistema** (`super_admin`), que passa por qualquer checagem porque é
   ele quem dá suporte entrando como o cliente;
2. o conjunto **inicial** de permissões, para quem ainda não tem perfil.

Quem autoriza é o **perfil de acesso** (`AccessProfile`), que cada cliente monta.

### Catálogo (`packages/shared/src/permissions.ts`)

Lista **fechada** de 19 permissões. Perfil nunca guarda permissão que o código não conheça —
senão vira texto livre no banco e ninguém mais sabe o que autoriza o quê.

| Grupo | Permissões |
|---|---|
| Atendimento | `conversations.view_all`, `conversations.transfer_any`, `conversations.internal_note`, `conversations.edit_message`, `conversations.delete_message`, `conversations.delete_chat`, `conversations.view_deleted`, `conversations.schedule_message`, `contacts.edit` |
| Conteúdo | `tags.manage`, `quick_replies.manage`, `flows.manage`, `variables.manage`, `agenda.manage`, `campaigns.manage` |
| Gestão | `reports.view`, `team.manage`, `profiles.manage`, `settings.manage` |
| Conta | `numbers.manage`, `billing.manage` |

`DEFAULT_PERMISSIONS` reproduz **exatamente** o acesso que cada papel já tinha antes dos
perfis. Em particular, `agent` inclui `quick_replies.manage` e `reports.view`: nenhum dos dois
era restrito, e tirá-los na migração seria perder acesso sem ninguém pedir. Depois disso,
`agent` ganhou `conversations.internal_note` (passagem de bastão entre atendentes): a migration
`agent_internal_note` acrescenta a permissão aos perfis "Atendente" padrão **não editados**
(`customized = false`); perfil editado pelo cliente fica como está. Do mesmo jeito, `agent` ganhou
`conversations.transfer_any`, `conversations.schedule_message` e `numbers.manage` (migration
`agent_default_permissions`) — o padrão do atendente hoje é: transferir/devolver atendimento de
outra pessoa, nota interna, editar mensagem, agendar mensagem, editar ficha do contato, respostas
rápidas, relatórios e números de WhatsApp. As três de apagar
(`delete_message`, `delete_chat`, `view_deleted`) entraram do mesmo jeito nos perfis padrão Gerente e
Administrador (migration `message_delete`) — regras em [Apagar mensagens](apagar-mensagens.md).
`variables.manage` (variáveis da empresa) idem, nos perfis padrão Gerente e Administrador não
editados (migration `global_variables`) — ver [Variáveis](variaveis.md).

## Como é aplicado

**`JwtAuthGuard`** resolve a lista a cada requisição e deixa em `user.permissions`.

As permissões **não vão no token** de propósito: se fossem assinadas, tirar o acesso de alguém
só valeria quando o token expirasse — 15 minutos entrando onde já não deveria. O custo é uma
consulta por requisição, amortizada por um cache de 15s (`PermissionsService`), limpo inteiro
quando um perfil ou um vínculo muda.

**`@RequirePermission('x')` + `PermissionsGuard`** substituem `@Roles` onde a regra é "o que
pode fazer". `@Roles('super_admin')` continua onde a regra é "quem é" (área do dono).
`@RequirePermission('a', 'b')` aceita quem tiver **qualquer** delas (ex.: criar variável da
empresa com `variables.manage` ou `flows.manage`).

**Dentro dos services.** As regras de conversa viviam como `role !== 'agent'` espalhadas pelo
`conversations.service.ts` — quem vê os atendimentos da equipe, quem transfere os dos outros,
quem escreve nota interna. Elas agora leem permissão. **Sem isso o "atendente líder" não
existiria**: trocar só os decorators dos controllers o deixaria vendo apenas os próprios
atendimentos.

## Regras que protegem o cliente de si mesmo

| Regra | Por quê |
|---|---|
| Sem perfil → vale o padrão do papel | ninguém perde acesso na migração |
| Perfil vazio concede **nada** | voltar ao padrão daria mais acesso do que o admin marcou na tela |
| Ninguém concede o que não tem (`grantable`) | senão quem tem `profiles.manage` cria um perfil com `billing.manage` e vira dono da conta |
| Perfil padrão não é excluível | o cliente nunca fica sem perfil de referência |
| Perfil com gente dentro não é excluível | jogaria essas pessoas no padrão do papel sem ninguém perceber |
| Perfil padrão não é renomeável | é a referência que a tela de Equipe mostra |

A tela desabilita as caixas que o editor não pode conceder, mas **a API corta de novo**: a
tela é conveniência, não segurança.

## API

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| GET | `/profiles` | — | Lista (cria os padrão na primeira chamada) |
| GET | `/profiles/catalog` | — | Catálogo + permissões de quem pediu |
| POST | `/profiles` | `profiles.manage` | Cria (filtra por `grantable`) |
| PATCH | `/profiles/:id` | `profiles.manage` | Edita (filtra por `grantable`) |
| DELETE | `/profiles/:id` | `profiles.manage` | Exclui (recusa padrão e em uso) |
| PATCH | `/tenants/me/agents/:id` | `team.manage` | `profileId` vincula; `""` desvincula |

## Interface

**Equipe** ganhou a seção **Perfis de acesso** e a coluna "Papel" virou **Perfil de acesso**,
com seletor por pessoa. `useCan('x')` esconde o que a pessoa não pode fazer.

## Próximo passo

Restrição por número (item 7 de [16](16-lacunas-primeiro-cliente.md)) encaixa aqui: é escopo
de dados, não ação, então provavelmente vira um campo do vínculo usuário↔número e não uma
permissão do catálogo.

## Restrição por número (escopo de dados)

Permissão é **ação**; "quais números esta pessoa atende" é **escopo de dados**. Por isso não
entrou no catálogo: `numbers.manage` ("pode configurar números") é outra coisa, e misturar as
duas faria um perfil chamado "atendente da filial Centro" que, ao ser reaproveitado em outro
cliente, restringiria as pessoas erradas.

Vive na tabela `user_numbers` (vínculo usuário↔número) e na tela de **Equipe**, no ícone de
telefone ao lado de cada pessoa. Só aparece quando o cliente tem **dois ou mais números** —
com um só não há o que escolher.

### A regra central

**Nenhum número marcado = opera todos.** Esse é o estado de quem nunca foi restringido e do
cliente com um número só. Se vazio significasse "nenhum", o primeiro deploy trancaria a
equipe inteira para fora do atendimento. `number-scope.ts` existe para essa regra ficar num
lugar só, testada.

### Onde é aplicado

| Ponto | Comportamento |
|---|---|
| Lista de conversas e contadores | filtradas pelos números da pessoa |
| Filtro por número na tela | interseccionado com o escopo; pedir um número que não opera devolve lista vazia, nunca ignora o pedido |
| Qualquer rota `/conversations/:id/…` | `ConversationScopeGuard` |

O guard responde **404, não 403**: um 403 confirmaria que a conversa existe, e para quem não
pode vê-la ela não deveria ser distinguível de uma inexistente. Ele fica no controller, em um
ponto só, porque são dez rotas `:id` hoje e vão aparecer mais — a que esquecessem de checar
seria o furo.

O dono do sistema nunca é restringido: é ele quem dá suporte entrando como o cliente.

### Departamentos (outro escopo de dados)

Mesmo desenho, em `auth/department-scope.ts` + `user_departments`: sem departamento = vê tudo; participante de algum (e sem `conversations.view_all`) vê os seus + os sem departamento. Aplicado nos mesmos pontos da tabela acima. Detalhes em [Departamentos](departamentos.md).

## Onde cada permissão aparece na tela

A API sempre recusou o que o perfil não permite — o problema era a **tela continuar oferecendo**: a pessoa clicava, batia num 403 e parecia defeito do sistema. Auditoria feita permissão a permissão:

| Permissão | Na tela |
|---|---|
| `conversations.view_all` | aba "Atendendo" vs "Minhas", seletor de atendente na lista |
| `conversations.transfer_any` | menu Transferir/Devolver no cabeçalho do chat |
| `conversations.internal_note` | modo nota interna |
| `conversations.edit_message` | lápis no hover de qualquer mensagem de texto enviada — própria, de colega, do celular ou do robô (na fila sempre; enviada até 15 min, só Evolution) — [Editar mensagens](editar-mensagens.md). Ligada nos três perfis padrão (migration `edit_message`) |
| `conversations.delete_message` | lixeira no hover de qualquer mensagem (sem ela, só nas próprias com menos de 2 dias) |
| `conversations.delete_chat` | botão "Limpar histórico" no cabeçalho do chat |
| `conversations.view_deleted` | olho no aviso "Mensagem apagada por…" para ver o original |
| `conversations.schedule_message` | relógio na barra do campo (agendar) e o X de cancelar na faixa de agendadas. Vendido à parte: no padrão só o Administrador tem ([Agendamento de mensagens](agendamento-de-mensagens.md)) |
| `contacts.edit` | ficha do contato fica só de leitura, com o motivo escrito |
| `tags.manage`, `flows.manage`, `agenda.manage`, `team.manage`, `reports.view`, `billing.manage` | item somem do menu lateral; `reports.view` também barra a rota direta |
| `quick_replies.manage` | botões de editar em /respostas |
| `numbers.manage` | botões em Números e o atalho em Configurações |
| `settings.manage` | horário de funcionamento e fluxos padrão |
| `variables.manage` | seção "Variáveis globais" em Configurações (editar/excluir) e o "+ Criar nova variável global" nos menus de variável — este também aparece para `flows.manage` (listar/inserir é de todos) |
| `profiles.manage` | edição de perfis |
| `campaigns.manage` | ainda sem tela (módulo sem interface) |

**Três checagens usavam o papel em vez da permissão** (`role !== 'agent'`) e foram trocadas: ver a fila da equipe, transferir e nota interna. Era o que impedia um "atendente líder" com perfil personalizado de enxergar a equipe — e o que deixava um gerente continuar vendo depois de o acesso ser retirado.

## Quais números cada pessoa atende

Fica em **Equipe → coluna Números**. Nenhum marcado = **todos**, que é o padrão de quem nunca foi restringido.

Antes isto era um ícone de telefone solto na coluna de ações **que sumia quando o cliente tinha menos de dois números** — ou seja, a funcionalidade existia no banco e não tinha como ser configurada por quem tem um número hoje e dois amanhã. Agora é coluna com o resumo escrito.

Isto é **escopo de dados, não permissão**: "pode configurar números" (`numbers.manage`) é outra coisa, e nenhuma permissão restringe por número.
