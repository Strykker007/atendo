# Escalas de trabalho, trava de login por turno e acessos temporários

Colaborador com **escala** só entra no painel dentro do turno. Fora dele, o login é bloqueado
até o gestor liberar um **plantão excepcional**. Para freelancers e substitutos, o gestor gera
um **acesso temporário** que expira sozinho.

## Escalas (`work_schedules`)

| Tipo | Como o turno é calculado |
|---|---|
| `FIXED_12X36` | Ciclo: `startTime`→`endTime` (normalmente 12h) + `restHours` de descanso (padrão 36). Repete a partir de `anchorDate` (um dia em que o turno começa), sem olhar o dia da semana |
| `COMMERCIAL_44H` | Dias da semana: o turno começa em `startTime` nos dias de `workDays` (0 = dom … 6 = sáb) |
| `CUSTOM` | `restHours = 0` → por dias da semana (como o comercial); `restHours > 0` → por ciclo (como a 12x36, com descanso livre) |

- Horários em hora **local**, no fuso de `tenant_settings.timezone`.
- `endTime <= startTime` = o turno vira a meia-noite e pertence ao dia em que começou.
- `toleranceMinutes` (padrão 15): login aceito alguns minutos **antes** do início. O fim é exato.
- Apagar a escala solta os colaboradores (`users.scheduleId` → null, sem trava).

Regra pura em `apps/api/src/modules/auth/shift-window.ts` (testes em `test/shift-window.test.ts`).

## Trava de login (`ShiftAccessService`)

`apps/api/src/modules/auth/shift-access.service.ts`, chamada em **`POST /auth/login`** e em
**cada `POST /auth/refresh`**. O access token dura `JWT_ACCESS_TTL` (15 min): quem sai do turno
cai na próxima renovação, sem precisar de checagem em toda rota.

Ordem:

1. Conta temporária vencida → `403 { code: "ACCOUNT_EXPIRED" }` (e a conta é expirada na hora).
2. `tenant_admin`, `super_admin` ou usuário **sem escala** → passa. Admin nunca é travado: alguém
   precisa conseguir entrar para liberar os outros.
3. Dentro do turno → passa.
4. Liberação ativa em `schedule_overrides` (`revokedAt` nulo, `validFrom <= agora < validUntil`) → passa.
5. Senão:

```json
{ "statusCode": 403, "code": "FOR_OUT_OF_SCHEDULE",
  "message": "FOR_OUT_OF_SCHEDULE: Acesso bloqueado. Solicite autorização de plantão ao gestor." }
```

No refresh recusado o token **não** é rotacionado. O front leva para `/login?bloqueio=<code>`,
que mostra o motivo (`ACCESS_BLOCK_MESSAGES` em `apps/web/src/lib/api.ts`).

## Liberação excepcional (`schedule_overrides`)

`userId`, `validFrom` (agora), `validUntil` (agora + 1…72h), `approvedById` (quem liberou; null
quando foi o dono entrando como o cliente), `reason` opcional, `revokedAt` (encerrada antes do
fim). Encerrar não derruba a sessão na hora: ela cai na próxima renovação do token.

## Contas temporárias

`POST /users/temporary` cria um **atendente** com `isTemporary = true` e
`accessExpiresAt = agora + horas` (1…72). O sistema gera o login
(`plantao-<hex>@<slug>.temp`) e uma senha aleatória, devolvida **uma única vez** na resposta.
Opcionalmente a conta também fica presa a uma escala.

Expiração automática:

- job `temporary-expiry` (fila `work-schedules`, a cada minuto) expira as vencidas;
- login/refresh de uma conta vencida também expira na hora (não depende do job).

Expirar = `isActive = false`, `expiredAt = agora` e todos os refresh tokens revogados: a conta não
serve para outro dia. Conta inativa deixa de contar em `maxAgents`. Status na listagem:
`ACTIVE`, `EXPIRED` (venceu ou foi encerrada) ou `INACTIVE` (desativada pela equipe).

## API

Todas exigem `team.manage` e filtram pelo `tenantId` do usuário logado.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/work-schedules` | Escalas do cliente, com quem está em cada uma |
| POST | `/work-schedules` | `{name, type, startTime, endTime, workDays?, restHours?, anchorDate?, toleranceMinutes?}` |
| PATCH | `/work-schedules/:id` | Mesmos campos, parciais (revalida a escala inteira) |
| DELETE | `/work-schedules/:id` | Apaga; colaboradores ficam sem escala |
| GET | `/work-schedules/team` | Equipe ativa agora: escala, `onShift`, `exempt` (admin/sem escala) e liberação ativa |
| GET | `/work-schedules/overrides` | Liberações ativas ou futuras |
| POST | `/work-schedules/overrides` | `{userId, hours (1–72), reason?}` — "Autorizar plantão excepcional" |
| DELETE | `/work-schedules/overrides/:id` | Encerra a liberação |
| PATCH | `/users/:id/schedule` | `{scheduleId \| null}` — gerente só altera atendentes; admin não recebe escala |
| GET | `/users/temporary` | Contas temporárias (últimas 100) com `status` |
| POST | `/users/temporary` | `{name, hours (1–72), scheduleId?, numberIds?}` → `{id, name, email, password, accessExpiresAt}`. Respeita `maxAgents` |
| POST | `/users/temporary/:id/expire` | Encerra o acesso antes do prazo |

## Telas

- **Configurações → Empresa → Escalas de trabalho** (`/configuracoes/escalas`; `/settings/schedules`
  redireciona): criar/editar escalas (12x36, 44h, personalizada) e associar cada atendente/gerente.
- **Escalas e plantões** no menu (`/escalas/aprovacoes`; `/schedules/approvals` redireciona): quem
  está no turno agora, botão **Autorizar plantão excepcional**, liberações ativas, modal **Gerar
  acesso temporário** (mostra login e senha uma vez, com botão de copiar) e lista dos temporários.
