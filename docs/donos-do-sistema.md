# Donos do sistema

Quem administra o Atendo (Financeiro, Clientes, Planos, Avisos), entra em qualquer cliente e
conversa na [Equipe do suporte](chat-interno.md#equipe-do-suporte). Até 20/10/2026 só existia o
`super_admin` sem cliente; um sócio que também opera uma empresa (o Danilo, admin do VogoChat
Plus) não tinha como ser dono sem sair dela.

## Dois jeitos de ser dono

| | `super_admin` | Marcação `users.isSystemOwner` |
|---|---|---|
| Empresa | nenhuma (`tenantId` null) | a dele, com o papel e o **plano** de lá |
| Menu | seção de dono + Configurações | menu da empresa + seção **Dono do sistema** |
| Plano/limites na empresa | — | valem normalmente (a marcação não libera recurso fora do plano) |
| Listas da equipe da empresa (atribuição, departamentos, empresas) | não aparece | aparece, como qualquer membro |

Regra única no código: dono = `role === 'super_admin'` **ou** `isSystemOwner`.

- **API:** `PermissionsService.scope` devolve `systemOwner` (lido do banco a cada requisição, com o
  cache de 15 s — tirar a marcação vale em segundos) e o `JwtAuthGuard` põe em `AuthUser.systemOwner`.
  O `RolesGuard` deixa o dono entrar nas rotas `@Roles('super_admin')`. O `PermissionsGuard` e o
  `FeatureGuard` **não** mudaram: dentro da empresa, o dono marcado tem as permissões do papel/perfil.
- **Token:** leva `owner: true` só para o socket (salas `owners` e `owner:<id>` da equipe do suporte).
- **Tela:** `GET /auth/me` devolve `systemOwner`; as telas de dono (`/admin`, `/clientes`,
  `/planos`, `/avisos`, `/donos`) checam esse campo.

## Ver cliente

O seletor **Ver cliente…** no topo do menu (só dono, `OwnerSwitcher.tsx`) faz o mesmo "entrar como"
da tela Clientes (`POST /tenants/:id/impersonate`), sem sair da tela: o menu passa a ser o do
cliente visitado **mais** a seção de dono. Troca direto de um cliente para outro. **← Voltar à minha
conta** (ou *Sair do cliente* na faixa) volta à empresa do dono, se ele tiver, ou ao Financeiro.

Entrando como, valem o papel de admin do cliente visitado e **nada** do cliente de origem do dono:
perfil, números, departamentos e empresas dele são ignorados (`PermissionsService.scope` com
`impersonatorId`), senão recortariam o cliente visitado por ids de outro cliente. O nome e o e-mail
no token vêm do banco (`AuthService.impersonate`), para trocar de cliente sem virar "Fulano (dono) (dono)".

## Tela Donos do sistema (`/donos`)

| Ação | Rota | Regra |
|---|---|---|
| Listar | `GET /super-admin/owners` | todos os donos, com empresa, papel, convite pendente, desativado |
| Buscar candidato | `GET /super-admin/owners/candidates?q=` | usuários ativos de clientes que ainda não são donos (nome/e-mail, 10) |
| Tornar dono (usuário existente) | `POST /super-admin/owners` `{userId}` | liga `isSystemOwner`; a pessoa continua na empresa |
| Convidar pessoa nova | `POST /super-admin/owners/invite` `{name,email}` | cria `super_admin` sem empresa com convite (e-mail quando houver; o link volta sempre). E-mail já usado → erro pedindo para buscar em "Usuário existente" |
| Novo link de convite | `POST /super-admin/owners/:id/invite-link` | só quem ainda não definiu a senha; invalida o anterior |
| Vincular a empresa | `POST /super-admin/owners/:id/link` `{tenantId, role}` | só dono **sem** empresa: vira o papel escolhido no cliente + `isSystemOwner`, perfil padrão do papel, e as sessões abertas caem (refresh revogado) para o vínculo valer já. Não passa pelo limite de usuários do plano |
| Tirar de dono | `DELETE /super-admin/owners/:id` | marcado: perde só a marcação. `super_admin` sem empresa: é **desativado** (não tem outro acesso). Ninguém tira a si mesmo, e sempre fica pelo menos um dono ativo |

O vínculo a uma empresa é feito **só por um dono**: um cliente não consegue convidar uma conta de
dono para a equipe dele (o e-mail é único no sistema, então o convite comum recusa).

## Chat interno

- **Equipe do suporte** = todo dono ativo (`StaffChatController`, `STAFF`).
- Dono marcado, na empresa dele: o widget mostra **Minha equipe | Equipe do suporte** em cima
  (`TeamAndStaffHome`); as não lidas somam as duas.

## Dados

`users.isSystemOwner boolean not null default false` — migração `20270110000000_system_owner`
(aditiva; começa desligada para todos).

## Fora do escopo

- Uma pessoa em várias empresas (o e-mail continua único: um usuário, uma empresa).
- Mudar contas em produção: depois do deploy, um dono marca os outros pela tela.

## Proteções dentro da empresa do dono marcado

- Admin/gerente do cliente **não** troca senha, e-mail, papel, perfil, números nem desativa um dono
  marcado (`PATCH /tenants/me/agents/:id` → 403); só nome e velocidade de digitação. Senão bastava
  ser admin do cliente para tomar a conta de dono — e com ela todos os clientes.
- Escala de trabalho do cliente não trava a sessão de um dono (`ShiftAccessService.sessionWindow`).
