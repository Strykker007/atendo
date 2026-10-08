# 20 — Modelos de perfil (verticais)

Um **modelo de perfil** (Farmácia, Clínica…) é o pacote com que um cliente novo já nasce:
permissões padrão dos perfis, respostas rápidas, fluxos e motivos de não compra. Só o dono do
sistema mexe (tela **Clientes → Modelos de perfil → Editar**, rota `/clientes/modelos/:id`).

Um modelo pode ser marcado como **padrão** (`isDefault`, no máximo um): ele já vem escolhido no
"Novo cliente" e é o usado quando `POST /tenants` não manda `templateId`.

## Criação do cliente

O formulário **Novo cliente** tem `Modelo de perfil: [ Farmácia (padrão) | Clínica | … | Nenhum ]`.
Na API: `templateId` ausente = modelo padrão (se houver); `null` = nenhum.
`POST /tenants` cria, **numa única transação**:

1. cliente + assinatura + configuração — motivos de não compra do modelo (`lossReasons`) ou,
   sem lista no modelo, `DEFAULT_LOSS_REASONS` do catálogo;
2. perfis de acesso (`access_profiles`, ver [18](18-perfis-de-acesso.md)):
   - **Administrador** — sempre todas as permissões (o modelo não restringe o admin: sem
     `profiles.manage` o cliente ficaria sem saída);
   - **Gerente** e **Atendente** — a matriz do modelo, se ele trouxer; senão o padrão do catálogo.
     Perfil padrão vindo do modelo nasce `customized = true`, senão o alinhamento ao catálogo
     desfaria a matriz;
   - perfis extras do modelo (qualquer outro nome) entram como perfis comuns;
3. pastas e respostas rápidas do modelo;
4. etiquetas citadas pelos fluxos + fluxos — **desligados** (os números ainda não existem; o admin
   revisa e liga). Desligado não conta em `maxFlows`;
5. o admin (com senha, ou convidado — o e-mail do convite sai só depois do commit).

Qualquer falha desfaz tudo — inclusive e-mail de admin repetido, que antes deixava cliente órfão.
Modelo com mais respostas do que o `maxQuickReplies` do plano é recusado (400) antes de criar.

**Nenhum** = sem modelo: só os três perfis do catálogo e os motivos do catálogo, sem respostas nem fluxos.

## Editor do modelo

- **Perfis e permissões** — lista com um cartão por perfil, cada um com as próprias permissões
  (editadas num modal, por grupo). Sempre aparecem Administrador (fixo: acesso total), Gerente e
  Atendente; "Novo perfil" cria quantos extras o segmento pedir ("Farmacêutico", "Atendente
  líder"…), podendo começar com as permissões de outro perfil. Gerente/Atendente nunca editados
  aparecem como "padrão do sistema" (acompanham permissões novas do catálogo); depois de editados
  ficam congelados na escolha, e "↺" volta ao padrão.
- **Respostas rápidas** — criar, editar, remover (pasta, título, texto); importar a exportação da
  tela Respostas de um cliente. Sem anexos.
- **Fluxos** — não são editados no modelo (o editor de fluxos depende de etiquetas, números e
  departamentos reais): monte num cliente (pode ser um de testes), exporte em Fluxos e importe
  aqui; mesmo nome substitui. Remover também é por aqui.
- **Motivos de não compra** — adicionar, reordenar, remover; "Usar os do catálogo" volta a
  seguir `DEFAULT_LOSS_REASONS` (máx. 30, sem repetidos).

Salva tudo de uma vez (`PATCH /tenant-templates/:id` com `content`); vale para os próximos
clientes.

`tenants.templateId` guarda de qual modelo o cliente veio. Em cliente com modelo, membro novo
(convite ou cadastro direto) entra no perfil padrão do seu papel, e trocar o papel de quem está
num perfil padrão troca o perfil junto — senão a matriz do modelo só valeria para quem alguém
vinculasse à mão. Perfil sob medida não é tocado.

Mudar ou excluir o modelo **não altera** clientes já criados: ele só é lido na criação.

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
  "lossReasons": ["Não respondeu", "Achou caro", "Receita vencida", "Outros"]
}
```

- `quickReplies` e `flows` são exatamente os itens das exportações de Respostas e Fluxos
  (formato portável — `quick-replies/portable.ts` e `packages/shared/src/portable.ts`): sem ids,
  etiquetas por nome, sem anexos.
- Permissão desconhecida é descartada; "Administrador" no arquivo é ignorado.
- Validação é tudo ou nada; fluxos passam pela mesma validação do editor.
- Código: `apps/api/src/modules/tenants/tenant-template.ts` (formato),
  `tenant-provisioning.service.ts` (provisionar / capturar), `tenant-templates.controller.ts`.

## Montando um modelo

O jeito prático é **Gerar de um cliente**: escolhe um cliente já redondo e o sistema tira dele
os perfis que ele ajustou (perfil padrão nunca editado fica de fora), as respostas, os fluxos e
os motivos de não compra.
Depois **Exportar** baixa o `.json`, **Carregar JSON** substitui o conteúdo de um modelo
existente e **Importar JSON** cria um modelo novo.

## API (super_admin)

| Método | Rota | O quê |
|---|---|---|
| GET | `/tenant-templates` | Lista: `{id, name, description, isDefault, updatedAt, tenants, profiles, quickReplies, flows, lossReasons}` (contagens; `lossReasons` null = catálogo) |
| GET | `/tenant-templates/:id` | Para o editor: `{id, name, description, isDefault, tenants, content, effectiveLossReasons}` |
| POST | `/tenant-templates` | `{name, description?}` — modelo vazio |
| GET | `/tenant-templates/:id/export` | O arquivo `.json` |
| POST | `/tenant-templates/import` | Novo modelo do arquivo (`{portable}` ou o arquivo cru). Nome repetido vira "(cópia)" |
| PUT | `/tenant-templates/:id` | Substitui o conteúdo pelo arquivo (mantém nome/descrição) |
| POST | `/tenant-templates/capture` | `{tenantId, name}` — modelo tirado de um cliente; devolve `{template, warnings}` (anexos que não vão) |
| PATCH | `/tenant-templates/:id` | `{name?, description?, isDefault?, content?}` — `isDefault: true` desmarca o anterior; `content` inteiro, mesma validação do arquivo (nome repetido = 409) |
| DELETE | `/tenant-templates/:id` | Exclui; clientes criados com ele ficam como estão (`templateId` vira null) |
