# Registro de acessos (auditoria de login)

Responde "quem estava logado em qual dia, de que horas a que horas". Não é relatório: fica em
**Escalas e plantões → Registro de acessos** (`/escalas/acessos`), com atalhos na **Equipe** (botão
"Registro de acessos" no topo e a data do último login de cada pessoa, que abre o calendário dela).
Exige `team.manage`. Dias e horas no fuso de `tenant_settings.timezone`.

O registro começa a contar a partir do deploy desta versão: não existe histórico anterior.
Sessões já abertas antes do deploy ganham uma sessão na primeira renovação do token.

## Dado (`user_sessions`)

Uma linha por login, do momento em que entrou até sair:

| Campo | O que é |
|---|---|
| `outcome` | `ok` = entrou; `out_of_schedule` = senha certa, barrado pela escala; `account_expired` = acesso temporário vencido |
| `startedAt` | login (ou troca de empresa, docs/multiempresa.md) |
| `lastSeenAt` | última renovação do token — a cada ~15 min (`JWT_ACCESS_TTL`) enquanto o painel está em uso |
| `endedAt` / `endReason` | saída registrada: `logout`, `shift_end` (turno acabou e a passagem terminou), `expired` (temporário venceu), `revoked` (senha trocada) |
| `ip`, `userAgent` | de onde entrou (a tela mostra "Chrome no Windows") |

`refresh_tokens.sessionId` liga cada token novo à sessão: a renovação só avança `lastSeenAt`, não
cria linha. Tentativa barrada grava uma linha com início = fim. Senha errada **não** grava (não dá
para saber de quem é a tentativa sem revelar se o e-mail existe).

**Fim da sessão sem saída registrada** (fechou o navegador): vale o `lastSeenAt`. Precisão de até
~15 min. Sem renovação há mais de 20 min (`ONLINE_STALE_MS`) = não está mais online.

Gravação em `apps/api/src/modules/auth/access-log.service.ts` (chamada por `AuthService` no login,
refresh, logout, troca de empresa e troca de senha). Conta pura em `access-log.ts` (testes em
`test/access-log.test.ts`): tempo online **une os intervalos** (duas abas ou celular + computador
juntos contam uma vez) e a sessão que vira a meia-noite é dividida entre os dois dias. O dono
"entrando como" um cliente não gera sessão (não é login da equipe).

## API (`team.manage`, filtrada pelo `tenantId` do usuário logado)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/access-log/people` | Pessoas da conta para a busca (inclui inativas e temporárias) |
| GET | `/access-log/day?date=AAAA-MM-DD` | Quem esteve logado no dia: primeiro login, último sinal, minutos online, logins, tentativas barradas e as sessões. Sem `date` = hoje |
| GET | `/access-log/user/:id?month=AAAA-MM` | Calendário da pessoa: minutos online, logins e barrados por dia + todas as sessões do mês |

## Tela

- **Por dia**: escolhe a data (setas, calendário, "Hoje") e filtra pelo nome. Cada pessoa mostra
  entrada, saída, tempo online, selo "online agora" e tentativas barradas; clicando, abre os logins.
  O dia de hoje atualiza a cada minuto.
- **Por pessoa**: busca pelo nome/e-mail; calendário do mês com o tempo online de cada dia (cor mais
  forte = mais horas) e ponto vermelho onde houve tentativa barrada. Clicar no dia lista os logins:
  entrada → saída, duração, como terminou, aparelho e IP.
- Filtros vão na URL (`?pessoa=…&mes=…&dia=…`), então dá para mandar o link.
