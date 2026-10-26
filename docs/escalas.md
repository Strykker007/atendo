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
- `toleranceMinutes` (padrão 15): login aceito alguns minutos **antes** do início.
- `exitGraceMinutes` (padrão 0, máx. 30): **tolerância para sair** — depois do fim, o painel segue
  funcionando por esses minutos, com contador na tela. 0 = trava no fim exato. Só vale para o fim do
  turno (liberação e conta temporária terminam na hora). Na escala por ciclo, entrada + saída
  precisam caber no descanso. "Quem está no turno agora" continua usando o fim real.
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
  "message": "Você está fora do horário da sua escala de trabalho.",
  "requestToken": "<jwt de 30 min>", "userName": "Ana Souza" }
```

A tela reage pelo `code`, nunca pelo texto. O `requestToken` só existe porque a senha já foi
conferida: ele abre as rotas do pedido de autorização (abaixo) e nada mais — é assinado com um
segredo próprio (`JWT_ACCESS_SECRET` + sufixo), então o `JwtAuthGuard` não o aceita como sessão.

No refresh recusado o token **não** é rotacionado. O front leva para `/login?bloqueio=<code>`,
que mostra o motivo (`ACCESS_BLOCK_MESSAGES` em `apps/web/src/lib/api.ts`).

## Pedido de autorização

Barrado no login, a pessoa vê um **popup** (`components/auth/AccessRequestModal.tsx`) em vez de
um erro: "Agora está fora do horário da sua escala…", com **Solicitar acesso** / **Agora não**.

1. **Solicitar acesso** → escolhe **para quem** pedir (quem tem `team.manage` no cliente, ou
   "qualquer gestor") e escreve o **motivo**; o texto confirma para quem vai. **Confirmar pedido**
   grava em `schedule_access_requests` (`pending`). Já havia um pendente: atualiza motivo e
   destinatário (não acumula pedidos repetidos).
2. O gestor escolhido (ou todos que podem aprovar) recebe na hora um aviso com som (socket
   `access_request`, sala da pessoa) e o contador no menu **Escalas e plantões**.
3. No painel, seção **Pedidos de autorização**: **Recusar** ou **Aprovar** — aprovar abre a
   escolha de **até que dia e hora** vale (atalhos +2h, +4h, +8h, +12h, até o fim do dia; no
   máximo 7 dias). Aprovar cria a `schedule_overrides` (de agora até lá) e liga ao pedido.
4. O popup confere a resposta a cada 10 s enquanto aberto: aprovado mostra "autorizou seu acesso
   até hoje às 22:00" e **Entrar agora** (refaz o login com a senha já digitada); recusado avisa.

## Fim de turno

Quando o turno (ou a liberação) acaba com a pessoa logada, a sessão **não cai**: entra no modo
fim de turno.

- **Antes**: avisos com som 15 e 5 min antes do fim real do turno ("vá concluindo ou devolva seus atendimentos").
- **Tolerância para sair** (se a escala tiver): no fim real, toca um som e aparece no topo uma faixa
  "Seu turno terminou às 07:00 — o painel trava em 4:59", com contagem regressiva. Tudo segue
  funcionando (mensagens, respostas, socket) até o prazo; aí vem a trava abaixo. O token leva
  `graceFrom` (fim real) além de `shiftEndsAt` (fim + tolerância).
- **Na hora**, a tela inteira trava (`components/layout/ShiftEndScreen.tsx`) com:
  - o **resumo do turno** (atendimentos assumidos, encerrados, transferidos — eventos desde o início do turno);
  - **Devolver N para a fila**: os atendimentos abertos com a pessoa voltam para Aguardando
    (`POST /me/shift/handoff`, pelo mesmo `release` do chat — fica no histórico), para o cliente
    não ficar preso com quem foi embora;
  - **Preciso de mais tempo**: o mesmo pedido de autorização do login; aprovado, destrava sozinho
    (socket `shift_unlocked`) e o painel recarrega;
  - **Sair agora** e a contagem regressiva: passados `HANDOFF_MS` (30 min) sem liberação, a sessão encerra.

**Segurança — quem decide é a API, não a tela:**

| Camada | Como trava |
|---|---|
| Token | `shiftEndsAt` (fim do turno + tolerância para sair, ou da liberação, o que for maior; conta temporária: o vencimento) e, na passagem, `locked` + `lockedUntil`. O token travado não vive além da passagem |
| `JwtAuthGuard` | Passou de `shiftEndsAt` ou `locked` → `403 SHIFT_ENDED` em toda rota, menos as `@ShiftLockOk` (`GET /auth/me`, `/me/shift`). Pela hora no token: zero consulta ao banco |
| Socket | Travado não entra na sala do cliente (não recebe mensagem nenhuma); ainda no turno, sai sozinho na hora exata (`shift_ended`). Continua só na sala da pessoa, para o aviso de destrave |
| Refresh | Reavalia escala e liberações no banco: no turno → token novo; acabou há < 30 min → token travado (passagem); depois disso → `403 FOR_OUT_OF_SCHEDULE` e a sessão acaba |
| Navegador | Travado, `api()` nem dispara pedidos fora das rotas de passagem (`allowedWhileLocked`) |

### Corte imediato

O token carrega a hora do fim — então uma mudança do gestor no meio do turno precisa valer
**na hora**, não quando o token vencer (até 15 min). Por isso, ao **encerrar uma liberação**,
**trocar a escala** de alguém, **editar uma escala**, **encerrar um acesso temporário** ou
**desativar** alguém na Equipe, a API grava `shift:cut:<userId>` no Redis (1 h) e manda os sockets
da pessoa saírem da sala do cliente (`emitShiftLocked`). Todo token emitido antes do corte
(`iatMs`) passa a valer como travado; a tela renova, e a renovação reavalia no banco — se a pessoa
ainda está no turno, destrava em instantes; se não, fica na passagem (ou cai, se desativada).
Custo: um `GET` no Redis por requisição, só para atendente/gerente (admin e dono nunca).

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

Todas exigem `team.manage` e filtram pelo `tenantId` do usuário logado — menos as três `/auth/access-requests`, que usam o `requestToken` (tenant e usuário vêm dele, nunca do corpo).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/work-schedules` | Escalas do cliente, com quem está em cada uma |
| POST | `/work-schedules` | `{name, type, startTime, endTime, workDays?, restHours?, anchorDate?, toleranceMinutes?, exitGraceMinutes?}` |
| PATCH | `/work-schedules/:id` | Mesmos campos, parciais (revalida a escala inteira) |
| DELETE | `/work-schedules/:id` | Apaga; colaboradores ficam sem escala |
| GET | `/work-schedules/team` | Equipe ativa agora: escala, `onShift`, `exempt` (admin/sem escala) e liberação ativa |
| GET | `/work-schedules/overrides` | Liberações ativas ou futuras |
| POST | `/work-schedules/overrides` | `{userId, hours (1–72), reason?}` — "Autorizar plantão excepcional" |
| DELETE | `/work-schedules/overrides/:id` | Encerra a liberação |
| POST | `/auth/access-requests/approvers` | **Sem sessão**, `{token}` (o `requestToken` do login): quem pode aprovar |
| POST | `/auth/access-requests` | **Sem sessão**, `{token, reason, approverId?}` — cria/atualiza o pedido pendente |
| POST | `/auth/access-requests/status` | **Sem sessão**, `{token}` — situação do último pedido (`validUntil` quando aprovado) |
| GET | `/me/shift` | **Qualquer logado, também travado**: resumo do turno, atendimentos abertos, `requestToken` para pedir mais tempo |
| POST | `/me/shift/handoff` | **Também travado**: devolve para a fila os atendimentos abertos com a pessoa |
| GET | `/work-schedules/access-requests` | Pedidos pendentes |
| POST | `/work-schedules/access-requests/:id/approve` | `{validUntil}` (ISO, até 7 dias) — cria a liberação |
| POST | `/work-schedules/access-requests/:id/deny` | Recusa |
| PATCH | `/users/:id/schedule` | `{scheduleId \| null}` — gerente só altera atendentes; admin não recebe escala |
| GET | `/users/temporary` | Contas temporárias (últimas 100) com `status` |
| POST | `/users/temporary` | `{name, hours (1–72), scheduleId?, numberIds?}` → `{id, name, email, password, accessExpiresAt}`. Respeita `maxAgents` |
| POST | `/users/temporary/:id/expire` | Encerra o acesso antes do prazo |

## Telas

**Escalas e plantões** no menu reúne tudo que é horário, em abas (`components/escalas/EscalasTabs.tsx`).
Cada aba exige a permissão da API dela e some sem ela; o item do menu aparece com qualquer uma e abre
na primeira permitida. Configurações mantém atalhos nos lugares antigos.

- **Escalas de trabalho** (`/escalas/turnos`, `team.manage`; `/configuracoes/escalas` e `/settings/schedules`
  redirecionam): criar/editar escalas (12x36, 44h, personalizada) e associar cada atendente/gerente.
- **Horário de atendimento** (`/escalas/horario-atendimento`, `settings.manage`): quadros, faixas e
  exceções da empresa (era Configurações → Atendimento).
- **Plantões e liberações** (`/escalas/aprovacoes`, `team.manage`; `/schedules/approvals` redireciona): quem
  está no turno agora, botão **Autorizar plantão excepcional**, liberações ativas, modal **Gerar
  acesso temporário** (mostra login e senha uma vez, com botão de copiar) e lista dos temporários.
- **Registro de acessos** (`/escalas/acessos`, `team.manage`): quem esteve logado em cada dia e o
  calendário de logins de cada pessoa — ver [registro-de-acessos.md](registro-de-acessos.md).
