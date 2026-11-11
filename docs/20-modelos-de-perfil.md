# 20 — Modelos de perfil (verticais)

Um **modelo de perfil** (Farmácia, Clínica…) é o pacote com que um cliente novo já nasce:
permissões padrão dos perfis, respostas rápidas, fluxos, tags (cor, Kanban, encerramento), **agentes de IA** (persona, regras, base, etapas/prompts), **tipos de ticket** (campos, prioridade, prazo), **departamentos com hierarquia**, o **acesso padrão** de cada perfil (em quais departamentos a pessoa nasce) e as **configurações de atendimento** (encerramento com ou sem venda, assinatura obrigatória, nome dos resultados, redistribuição automática e saiu do plantão).

**Regra do projeto (11/11/2026)**: toda configuração escalável nova — por pessoa ou do cliente — precisa
entrar no modelo (formato, criação, "Gerar de um cliente" e "Aplicar aos clientes"). O que é do cliente
(números, telefones) não viaja; o modelo cita por nome. Só o dono do
sistema mexe (tela **Clientes → Modelos de perfil → Editar**, rota `/clientes/modelos/:id`).

Um modelo pode ser marcado como **padrão** (`isDefault`, no máximo um): ele já vem escolhido no
"Novo cliente" e é o usado quando `POST /tenants` não manda `templateId`.

## Criação do cliente

O formulário **Novo cliente** tem `Modelo de perfil: [ Farmácia (padrão) | Clínica | … | Nenhum ]`.
Na API: `templateId` ausente = modelo padrão (se houver); `null` = nenhum.
`POST /tenants` cria, **numa única transação**:

1. cliente + assinatura + configuração (`tenant_settings` com o `settings` do modelo: `salesEnabled`, `requireSignature`, `wonLabel`, `lostLabel`; o que o modelo não define fica no padrão) + **tags** (`provisionedTags`; as marcadas Comprou/Não comprou viram **motivos de encerramento** — `close_reasons` — e só continuam tag se forem etapa do Kanban; "Gerar de um cliente" traz os motivos de volta como tags marcadas): as de `tags` do modelo, na
   ordem dele (é a das colunas do Kanban), cada uma com cor, `isKanban`, `showOnWon` e `showOnLost`. Modelo
   sem `tags` (formato antigo): `lossReasons` — ou, sem ela, `DEFAULT_LOSS_REASONS` do catálogo —
   como tags de encerramento **fora do Kanban** com a cor de `lossReasonColors`;
2. departamentos do modelo, com o pai pelo nome (`createTemplateDepartments`), e depois os perfis de
   acesso (`access_profiles`, ver [18](18-perfis-de-acesso.md)) — perfil com `access` nasce com
   [acesso padrão](18-perfis-de-acesso.md#acesso-padrão-do-perfil): todos os números, recebe de todos e os
   departamentos do modelo. O recorte por número vem do departamento de cada número, que o cliente
   escolhe depois de conectar ([hierarquia](departamentos.md#hierarquia)):
   - **Administrador** — sempre todas as permissões (o modelo não restringe o admin: sem
     `profiles.manage` o cliente ficaria sem saída);
   - **Gerente** e **Atendente** — a matriz do modelo, se ele trouxer; senão o padrão do catálogo.
     Perfil padrão vindo do modelo nasce `customized = true`, senão o alinhamento ao catálogo
     desfaria a matriz;
   - perfis extras do modelo (qualquer outro nome) entram como perfis comuns;
3. pastas e respostas rápidas do modelo;
4. tipos de ticket e agentes de IA do modelo (antes dos fluxos: o fluxo cita os dois **pelo nome**;
   alvos do agente — etiquetas e motivos — também pelo nome; agente com etapa inválida recusa o
   modelo ao salvar/importar, não na criação);
5. etiquetas citadas pelos fluxos + fluxos — **desligados** (os números ainda não existem; o admin
   revisa e liga). Desligado não conta em `maxFlows`;
6. o admin (com senha, ou convidado — o e-mail do convite sai só depois do commit).

Qualquer falha desfaz tudo — inclusive e-mail de admin repetido, que antes deixava cliente órfão.
Modelo com mais respostas do que o `maxQuickReplies` do plano é recusado (400) antes de criar.

**Nenhum** = sem modelo: só os três perfis do catálogo e os motivos do catálogo, sem respostas nem fluxos.

## Editor do modelo

- **Atendimento** — interruptores **Encerramento com venda** e **Assinatura obrigatória** e os nomes dos resultados (positivo / negativo), as mesmas opções de Configurações → Atendimento ([06](06-modelo-de-dados.md#encerramento-sem-venda)). Desligar a venda com os nomes vazios sugere "Resolvido" / "Não resolvido". Nada definido = padrão do sistema. "Gerar de um cliente" copia as do cliente.
- **Perfis e permissões** — lista com um cartão por perfil, cada um com as próprias permissões
  (editadas num modal, por grupo). Sempre aparecem Administrador (fixo: acesso total), Gerente e
  Atendente; "Novo perfil" cria quantos extras o segmento pedir ("Farmacêutico", "Atendente
  líder"…), podendo começar com as permissões de outro perfil. Gerente/Atendente nunca editados
  aparecem como "padrão do sistema" (acompanham permissões novas do catálogo); depois de editados
  ficam congelados na escolha, e "↺" volta ao padrão.
- **Atendimento** também tem **Redistribuir quem está aguardando**, **Redistribuir quem está com
  atendente** (minutos iniciais, máximos e vezes) e **Saiu do plantão** (minutos), com as mesmas faixas
  de Configurações → Atendimento.
- **Departamentos** — nome, cor, descrição e **Fica abaixo de** (árvore). Renomear acompanha o pai dos
  filhos e o acesso padrão dos perfis; remover sobe os filhos para o pai dele. Até 50; pai inexistente
  ou ciclo vai para o topo.
- **Perfis → Acesso padrão** — caixa no modal do perfil: os departamentos em que quem for cadastrado
  nesse perfil já nasce. Números não entram (são do cliente).
- **Respostas rápidas** — criar, editar, remover (pasta, título, texto); importar a exportação da
  tela Respostas de um cliente. Sem anexos.
- **Fluxos** — não são editados no modelo (o editor de fluxos depende de etiquetas, números e
  departamentos reais): monte num cliente (pode ser um de testes), exporte em Fluxos e importe
  aqui; mesmo nome substitui. Remover também é por aqui.
- **Agentes de IA** e **Tipos de ticket** — como os fluxos, não são editados no modelo: monte num
  cliente, exporte (**Agentes de IA → Exportar**, **Tickets → Tipos → Exportar**) e importe aqui
  (mesmo nome substitui); remover também por aqui. Documentos do agente e departamento/setor
  padrão não viajam (são do cliente) — a exportação avisa.
- **Tags** — as mesmas opções da tela de Tags do cliente: cor (bolinha → paleta ou cor livre),
  interruptores **Kanban**, **Comprou** e **Não comprou** por linha, **Conflita com** (botão ⇄ N: escolhe as tags que saem quando esta é marcada — simétrico, até 20; tag que vira motivo de encerramento não tem conflito no cliente novo), arrastar pela alça para ordenar (ordem das colunas),
  remover; selecionar todas com Encerramento (Mostrar/Tirar em Comprou e em Não comprou), Pôr/Tirar do Kanban, Cor e
  Remover; adicionar várias de uma vez (uma por linha ou `;`, com cores variadas para começar e
  as opções para as novas: Comprou, Não comprou, Kanban). Sem lista própria, mostra as de encerramento do catálogo (ou do
  formato antigo do modelo) e a primeira edição as copia para `tags`; "Voltar às do catálogo"
  desfaz. Máx. 200, sem repetidos (ignorando maiúsculas), nome até 40 caracteres.

Salva tudo de uma vez (`PATCH /tenant-templates/:id` com `content`); vale para os próximos
clientes.

`tenants.templateId` guarda de qual modelo o cliente veio. Em cliente com modelo, membro novo
(convite ou cadastro direto) entra no perfil padrão do seu papel, e trocar o papel de quem está
num perfil padrão troca o perfil junto — senão a matriz do modelo só valeria para quem alguém
vinculasse à mão. Perfil sob medida não é tocado.

Mudar ou excluir o modelo **não altera** clientes já criados: ele só é lido na criação. Para levar
uma mudança a quem já existe, use [Aplicar aos clientes](#aplicar-aos-clientes).

## Aplicar aos clientes

Botão **Aplicar aos clientes** no editor do modelo (desabilitado com alteração não salva — vale o
modelo **salvo**). O dono escolhe **o que** e **para quem**, vê a **prévia** cliente por cliente e só
então grava. Partes, todas opcionais:

- **Perfis** (um a um, os que o modelo ajusta): as permissões do modelo substituem as do perfil
  correspondente no cliente — pelo `systemRole` quando o perfil do modelo é um Gerente/Atendente
  padrão renomeado (o nome do cliente passa a ser o do modelo), senão pelo nome; perfil que não existir é criado (Gerente/Atendente como perfil padrão).
  Perfil padrão alterado passa a `customized` (o alinhamento ao catálogo não desfaz). Administrador
  nunca muda. O cache de permissões é invalidado na hora.
- **Motivos de encerramento**: as tags do modelo marcadas Comprou / Não comprou (Comprou e Não
  comprou = `both`). Mesmo nome — ignorando maiúsculas, acento e emoji/símbolo no começo ("Achou caro" = "💰 Achou caro") → atualiza resultado e cor, reativa e **renomeia mantendo o id** (histórico, filtro e relatórios continuam nele); o que
  faltar é criado; ordem = a do modelo. Motivos de atendimento interno (`ignoreInReports`) não são
  tocados. **Deixar idêntico ao modelo** desativa os motivos do cliente que não estão no modelo
  (desativar, não apagar: histórico e relatórios mantêm o nome); sem isso, eles continuam ativos
  depois dos do modelo.
- **Configurações de atendimento**: grava no cliente só o que o modelo define (encerramento com/sem venda, assinatura obrigatória, nomes dos resultados); o resto das configurações dele não muda. A prévia lista o que muda ("Encerramento com venda: desligado").
- **Tags que faltam**: cria as tags do modelo (as que continuam tag na criação do cliente) que o
  cliente não tem, no fim da lista. Não altera nem remove as dele; conflitos não são replicados.

- **Departamentos que faltam**: cria os do modelo que o cliente não tem (pelo nome, ignorando
  maiúsculas), já com o pai; os que ele já tem (e a árvore dele) não mudam. Marque junto com os perfis
  para o acesso padrão achar os departamentos.
- **Perfis** também levam o acesso padrão do modelo: troca os **departamentos** do acesso padrão do
  perfil no cliente (os que ele não tem ficam de fora); os números que o cliente já marcou no perfil
  ficam. Não mexe em quem já está no perfil — no cliente, o **Reaplicar** do perfil faz isso.
- **Configurações de atendimento** inclui redistribuição e saiu do plantão quando o modelo define.
- **Tipos de ticket que faltam** e **Agentes de IA que faltam**: cria os do modelo que o cliente não
  tem (pelo nome, ignorando maiúsculas); os que ele já tem não mudam.

**Gerar de um cliente** traz também os departamentos ativos (com a árvore), o acesso padrão dos perfis
(só os departamentos — avisa se o perfil tinha números marcados) e as configurações de redistribuição
e saiu do plantão.

Para quem: todos os clientes ativos ou uma seleção. Cada cliente roda numa transação própria.
Respostas rápidas e fluxos não entram (ainda).

Fluxo típico para padronizar Comprou / Não comprou: montar a lista num cliente →
**Gerar de um cliente** (ou editar as tags do modelo com os interruptores Comprou / Não comprou) →
Salvar → Aplicar aos clientes → Motivos de encerramento + Deixar idêntico → prévia → Aplicar.

## Arquivo `.json`

```json
{
  "atendo": "tenant-template",
  "version": 1,
  "name": "Farmácia",
  "description": "Balcão + entrega",
  "profiles": [
    { "name": "Gerente", "permissions": ["conversations.view_all", "reports.view", "team.manage"] },
    { "name": "Atendente", "permissions": ["conversations.internal_note", "quick_replies.manage"] },
    { "name": "Atendente líder", "permissions": ["conversations.view_all"] }
  ],
  "quickReplies": [ { "atendo": "quick-reply", "version": 1, "folder": "Entrega", "title": "Prazo", "body": "…" } ],
  "flows": [ { "atendo": "flow", "version": 1, "name": "Boas-vindas", "trigger": {}, "definition": {} } ],
  "tags": [
    { "name": "Novo lead", "color": "#0ea5e9", "isKanban": true, "conflictsWith": ["Cliente"] },
    { "name": "Cliente", "color": "#16a34a", "isKanban": true },
    { "name": "Indicação", "color": "#22c55e", "showOnWon": true },
    { "name": "Achou caro", "color": "#f59e0b", "showOnLost": true },
    { "name": "Receita vencida", "color": "#dc2626", "showOnLost": true }
  ],
  "settings": { "salesEnabled": true, "requireSignature": false, "wonLabel": "Comprou", "lostLabel": "Não comprou" },
  "aiAgents": [ { "atendo": "ai-agent", "version": 1, "name": "Atendente virtual", "persona": "…", "tone": "friendly", "rules": "…", "knowledge": "…", "stages": [], "maxReplies": 20, "isActive": true, "targets": { "tagNames": ["Cliente"], "closeReasonNames": ["Achou caro"], "contactFields": ["name"] } } ],
  "ticketTypes": [ { "atendo": "ticket-type", "version": 1, "name": "Encomenda de produto", "color": "#10b981", "priority": "normal", "dueDays": 2, "fields": [ { "key": "produto", "label": "Produto", "type": "text", "required": true } ], "isActive": true } ]
}
```

- `tags`: com que o cliente nasce, na ordem. `color` opcional (`#rrggbb`; inválida recusa o
  arquivo); `isKanban`/`showOnWon`/`showOnLost` ausentes = `false` (`showOnClose: true`, de antes da separação, vale como os dois); repetida (ignorando maiúsculas) é
  descartada.
- `conflictsWith` (opcional, por tag): nomes de outras tags do modelo que não convivem com ela
  (`tag_conflicts` no cliente novo). Simétrico — basta um lado. Nome fora da lista ou a própria
  tag somem em silêncio; mais de 20 opostas para uma tag (contando os dois lados) recusa o
  arquivo. Na criação do cliente só valem os pares entre tags que continuam tag (as que viram
  motivo de encerramento ficam de fora). "Gerar de um cliente" traz os conflitos dele.

- `lossReasons` / `lossReasonColors` (formato antigo, só leitura): `.json` e modelos de antes de
  `tags` continuam valendo — viram tags fora do Kanban, com a cor de cada uma, que aparecem nos dois
  encerramentos (Comprou e Não comprou), como era antes da separação.
  Com `tags` presente, as duas são ignoradas, e salvar pelo editor grava só `tags`.
- `settings` (opcional): `salesEnabled` e `requireSignature` booleanos (outro tipo recusa o arquivo), `wonLabel`/`lostLabel` até 30 caracteres. Chave ausente = padrão do sistema.
- `aiAgents` e `ticketTypes` são os itens das exportações de Agentes de IA e de Tipos de ticket
  (`packages/shared/src/portable-extras.ts`); gravação no cliente em `tenants/portable-db.ts`.
- Nos fluxos, o bloco IA (modo Agente) e o "Abrir ticket" levam `aiAgentName` / `ticketTypeName`
  no lugar do id (`scrubFlowDefinition` / `restoreFlowDefinition`). No destino casa com o de mesmo
  nome; sem ele, o bloco fica marcado "Reconfigurar" (o agente sai por Não conseguiu até escolher).
  Antes, o id do agente viajava cru e apontava para o cliente de origem.
- `quickReplies` e `flows` são exatamente os itens das exportações de Respostas e Fluxos
  (formato portável — `quick-replies/portable.ts` e `packages/shared/src/portable.ts`): sem ids,
  etiquetas por nome, sem anexos.
- Permissão desconhecida é descartada; "Administrador" no arquivo é ignorado.
- Validação é tudo ou nada; fluxos passam pela mesma validação do editor.
- Código: `apps/api/src/modules/tenants/tenant-template.ts` (formato),
  `tenant-provisioning.service.ts` (provisionar / capturar), `tenant-templates.controller.ts`.

## Montando um modelo

O jeito prático é **Gerar de um cliente**: escolhe um cliente já redondo e o sistema tira dele
os perfis que ele ajustou (perfil padrão nunca editado fica de fora), as respostas, os fluxos, os
**agentes de IA** (sem documentos), os **tipos de ticket** e **todas as tags** na ordem do Kanban, com cor, Kanban, Comprou e Não comprou (até 200).
Depois **Exportar** baixa o `.json`, **Carregar JSON** substitui o conteúdo de um modelo
existente e **Importar JSON** cria um modelo novo.

## API (super_admin)

| Método | Rota | O quê |
|---|---|---|
| GET | `/tenant-templates` | Lista: `{id, name, description, isDefault, updatedAt, tenants, profiles, quickReplies, flows, tags}` (contagens; `tags` = quantas o cliente recebe) |
| GET | `/tenant-templates/:id` | Para o editor: `{id, name, description, isDefault, tenants, content, effectiveTags}` (`effectiveTags` = o que o cliente recebe hoje, inclusive em modelo sem `tags`) |
| POST | `/tenant-templates` | `{name, description?}` — modelo vazio |
| GET | `/tenant-templates/:id/export` | O arquivo `.json` |
| POST | `/tenant-templates/import` | Novo modelo do arquivo (`{portable}` ou o arquivo cru). Nome repetido vira "(cópia)" |
| PUT | `/tenant-templates/:id` | Substitui o conteúdo pelo arquivo (mantém nome/descrição) |
| POST | `/tenant-templates/capture` | `{tenantId, name}` — modelo tirado de um cliente; devolve `{template, warnings}` (anexos que não vão) |
| PATCH | `/tenant-templates/:id` | `{name?, description?, isDefault?, content?}` — `isDefault: true` desmarca o anterior; `content` inteiro, mesma validação do arquivo (nome repetido = 409) |
| POST | `/tenant-templates/:id/rollout` | `{tenantIds? (ausente = todos os ativos), profiles?: string[], closeReasons?, replaceCloseReasons?, tags?, dryRun?}` — aplica o modelo salvo em clientes existentes; devolve por cliente `{tenantId, name, profiles: {created, updated}, closeReasons: {created, updated, reactivated, deactivated}, tags: {created}}`. `dryRun` = prévia sem gravar |
| DELETE | `/tenant-templates/:id` | Exclui; clientes criados com ele ficam como estão (`templateId` vira null) |
