# Uma pessoa em várias empresas

Até 23/10/2026 valia "um e-mail = um usuário = uma empresa". O dono do sistema que também é dono de
uma empresa e **síndico** de outra (membro comum lá, com o plano de lá) precisava de dois logins, ou
só visitava a segunda como dono ("entrando como"): aparecia como "Fulano (dono)", não recebia
transferências e não contava na equipe.

## Modelo: login principal + vínculos

Cada empresa em que a pessoa atua tem **a própria linha em `users`**, com papel, perfil, números,
departamentos, empresas e escala daquela empresa. Conversas atribuídas, mensagens, chat interno,
presença e limites do plano continuam funcionando como para qualquer membro, porque é um membro.

- **Login principal:** a linha com e-mail e senha (como sempre).
- **Vínculo:** linha com `primaryUserId` apontando para o login principal, **sem e-mail nem senha**
  (`email` null, senha aleatória inutilizável). Não entra pelo `/auth/login`: a pessoa entra pelo
  principal e troca no seletor.

Migração `20270111000000_user_memberships` (aditiva): `users.email` passa a aceitar null (o índice
único continua; o Postgres aceita vários null) e `users.primaryUserId` (FK para `users`, cascade).

### O que é da pessoa e o que é da empresa

| Da pessoa (login principal) | Da linha da empresa |
|---|---|
| e-mail e senha (trocar senha vale para todas; senha nova derruba as sessões de todas) | papel, perfil, números, departamentos, empresas, escala |
| nome (editar o próprio nome atualiza todas as linhas) | atribuições, mensagens, transferências, presença |
| **ser dono do sistema** (menus de dono, equipe do suporte): qualquer linha dela marcada `isSystemOwner` ou `super_admin` | **acesso amplo**: só na empresa em que a linha dela é marcada ([Donos › Acesso amplo](donos-do-sistema.md#acesso-amplo)) |

Exemplo: Tiago, login principal `super_admin` (sem empresa); vínculo na Atendo como admin **e dono**
(a Atendo tem acesso amplo); vínculo no condomínio como admin, **sem** marcação (o condomínio segue o
plano dele). No condomínio, o Tiago continua vendo os menus de dono.

`AuthService.person(userId)` resolve a pessoa: `personId` (login principal), e-mail do login e `owner`.
O e-mail de qualquer linha, para mostrar ou mandar e-mail, sai de `loginEmail()`
(`auth/login-email.ts`, com `LOGIN_EMAIL_SELECT`): o próprio ou o do principal. Os e-mails de cobrança
para os admins de um cliente usam isso, então o síndico admin recebe pelo e-mail do login dele.

## Sessão

- **Token:** `sub` = a linha da sessão (empresa atual); `pid` = login principal, só quando a sessão é
  de um vínculo; `email` = do login; `owner` = pessoa dona. `AuthUser.personId` = `pid ?? sub`.
- **Trocar de empresa:** `POST /auth/switch {userId}`. Só entre linhas da mesma pessoa (senão 403);
  linha desativada não entra; escala e conta temporária da empresa de destino valem como num login.
  Devolve access token e grava **um novo refresh cookie**, da linha escolhida. Como o cookie é um só
  por navegador, as outras abas passam para a mesma empresa na próxima renovação.
- **Renovar:** refresh de um vínculo exige o login principal ativo. Desativar o principal tira a
  pessoa de todas as empresas.
- **"Entrando como" (dono):** continua igual, mas sempre pelo login principal (`impersonatorId` =
  pessoa). Escolher uma das próprias empresas no seletor sai do "entrando como".
- **Equipe do suporte:** por pessoa. Salas `owner:<personId>`, presença e conversas do suporte usam o
  `personId`, então o chat é o mesmo em qualquer empresa (`StaffChatController`, `STAFF` = logins
  principais donos).

## Seletor

`WorkspaceSwitcher.tsx`, no topo do menu, abre também com **Ctrl+K** (⌘K):

- **Minhas empresas** (`GET /auth/memberships`): o login principal e os vínculos ativos, com o papel
  em cada uma ("dono" onde atua como dono). Escolher = `/auth/switch`.
- Só para dono: **Recentes** (os últimos 5 clientes visitados, no `localStorage`) e **Todos os
  clientes**, com busca sem acento. Escolher um cliente = "entrar como" (`POST /tenants/:id/impersonate`).
- Aparece para quem é dono ou tem mais de uma empresa. Setas + Enter navegam; Esc fecha.

## Quem cria e desfaz vínculos

Só dono do sistema, na tela **Donos do sistema** (`/donos`) → **Adicionar empresa** no dono:

- `POST /super-admin/owners/:id/link {tenantId, role, owner}` cria a linha (ou reativa uma desativada
  na mesma empresa, com o histórico dela). `owner: true` = "atua como dono nesta empresa" (acesso amplo).
  Não passa pelo limite de atendentes do plano, mas a linha conta nele dali em diante.
- `DELETE /super-admin/owners/:id/link/:userId` desativa a linha (conversas e histórico ficam) e
  derruba as sessões dela. O admin da empresa também pode desativar o vínculo pela Equipe, como
  qualquer membro.

Na **Equipe** da empresa, o vínculo aparece com o e-mail do login e a nota "login de outra empresa".
Ninguém dali troca o e-mail ou a senha dele, nem gera convite (a API recusa com 400). Papel, perfil,
números e desativar seguem as regras de qualquer membro (e as de dono marcado, se for).

## Fora do escopo

- Admin de cliente adicionar uma pessoa que já existe em outra empresa: hoje só o dono do sistema cria
  vínculo. Para pessoas que não são donas, o caminho continua sendo um login próprio.
- Login direto numa empresa vinculada: entra no principal e troca (o seletor guarda os recentes).

## Compatibilidade e retorno

A migração é aditiva e a API anterior funciona com ela **enquanto não existir vínculo**. Depois de
criar vínculos, voltar a versão da API deixa essas linhas com e-mail vazio nas telas antigas, e o
seletor some; o login principal segue funcionando. Para desfazer de vez: desativar os vínculos em
`/donos` antes de voltar a versão.
