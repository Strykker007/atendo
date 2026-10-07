# Empresas e unidades (multi-empresa)

Um cliente (tenant) pode ter várias **empresas/unidades** — matriz, filial Centro, filial Norte.
Cada empresa reúne **números de WhatsApp**; quem é vinculado a ela enxerga só as conversas
desses números e alterna entre as suas unidades pelo seletor no topo do menu.

## Modelo

- `companies` — `id, tenantId, name (único no cliente), cnpj? (só dígitos), description?`.
- `whatsapp_numbers.companyId` — opcional. Um número pertence a **no máximo uma** empresa;
  número sem empresa só é visto por quem não está restrito a empresa.
- `user_companies` — N:N usuário × empresa. **Sem nenhuma linha = todas as empresas**
  (mesma regra de `user_numbers` e `user_departments`: cadastrar a primeira empresa não pode
  trancar a equipe para fora).
- Limite do plano: `PlanLimits.maxCompanies` (ausente/`null` = ilimitado), checado no
  `POST /companies` via `@RequireLimit('maxCompanies')`. Aparece em *Plano e uso* e no
  formulário de planos do dono.

## Como o escopo funciona

A empresa **não** ganha filtro próprio em cada consulta: ela vira **números**, e todo o sistema
já restringe por número (`number-scope.ts`). O `JwtAuthGuard` faz a conversão em toda
requisição (`company-scope.ts`):

1. Empresas permitidas = as de `user_companies` (ou todas, sem vínculo).
2. Header `x-company-id` (o seletor do painel) — ignorado se não for uma empresa permitida.
3. Números efetivos = `user_numbers` ∩ números da empresa ativa (ou da união das permitidas,
   quando a pessoa é restrita e não escolheu uma).
4. Interseção vazia vira `[NO_NUMBER]` (um id que não casa com nada) — lista vazia significa
   "todos" em `number-scope.ts`, e a unidade sem número não pode mostrar as outras.

Cliente sem empresas: nenhuma consulta extra além do cache (`PermissionsService.companyNumbers`,
15 s, limpo ao salvar empresa).

O tempo real não muda: o socket só avisa "algo mudou" e o painel refaz a consulta, que já
vai com o header.

## Painel

- **Seletor** (`components/layout/CompanySwitcher.tsx`, abaixo da marca no menu): some quando
  o cliente não tem empresas. "Todas as empresas" só para quem tem `conversations.view_all`
  (admin/gerente); o atendente escolhe uma de cada vez (cai na primeira automaticamente).
  Trocar de empresa limpa número/conversa abertos e recarrega todos os dados.
  A escolha fica no navegador (`useUI.companyId`) e vai em toda chamada (`lib/api.ts`).
- **Cadastro** em *Configurações → Empresas e unidades* (`settings.manage`): nome, CNPJ,
  descrição, quais números e quais pessoas.
- **Lista de conversas**: o seletor de número mostra só os números da empresa ativa.
- **Pelo dono** (*Clientes → Empresas*, sem "Entrar como"): o mesmo formulário (`CompaniesSection
  tenantId=…`), via `/admin/tenants/:tenantId/companies` (super_admin). O dono **não** esbarra no
  `maxCompanies`: o limite é para o autoatendimento do cliente, e passar dele é decisão do dono — a
  tela mostra o limite do plano e avisa quando o cliente está acima.

## Fila agrupada por atendente

Na lista de conversas, o botão com ícone de duas pessoas (ao lado de *Aguardando / Atendendo /
Encerrado*) liga o modo agrupado: uma seção recolhível por atendente responsável (com
quantidade e não lidas), em ordem alfabética, e **Sem atendente · Fila** por último. Dentro de
cada seção a ordem é a da lista (o agrupamento separa, não reordena). Desligado, volta à lista
cronológica. A preferência e as seções recolhidas ficam salvas no navegador.
