# Horários, faixas, boas-vindas e estabelecimento fechado

Tarefa 2. Substitui o antigo "Horário de funcionamento" (`business_hours`) e o "Aviso de fora do expediente" (`outsideHoursText`). Tela: **Configurações → Horários de atendimento** e **Configurações → Boas-vindas**.

## Modelo

**Quadro de horários** (`BusinessSchedule`, tabela `business_schedules`): por empresa, com **fuso próprio**. Um é o padrão (`isDefault`); um número pode usar outro (`WhatsAppNumber.scheduleId`, nulo = padrão). **Cliente sem nenhum quadro = sempre aberto**, sem resposta de fechado (mesma regra antiga de "sem expediente cadastrado").

O conteúdo do quadro é `config: ScheduleConfig` (JSON, `packages/shared/src/schedule.ts`), salvo inteiro pelo editor e validado pela mesma função no editor e na API (`validateSchedule`):

| Campo | O que é |
|---|---|
| `bands: ScheduleBand[]` | **Faixas** criadas pelo cliente ("Aberto", "Entrega encerrada"…): `name` (único, sem diferenciar maiúsculas; "Fechado" é reservado), `color`, `open` (conta como horário de atendimento), `behavior`, `reply` + `items`/`flowId` |
| `closed` | Faixa fixa **Fechado** (`CLOSED_BAND_ID = 'closed'`): só comportamento e resposta. Vale fora de qualquer intervalo e com "atendimento ativo" desligado. Nunca conta como atendimento |
| `week: ScheduleInterval[][]` | Grade semanal (índice 0 = domingo). Intervalo `{ id, start, end, bandId }` em HH:MM no fuso do quadro |
| `exceptions` | **Exceções por data** `{ id, date: 'YYYY-MM-DD', label?, closed, intervals }`: dia fechado ou com intervalos próprios, no lugar da grade |

### Regras de horário
- `end <= start` atravessa a meia-noite: `22:00–02:00` vale até 02:00 do **dia seguinte**; `22:00–00:00` vai até a meia-noite; `00:00–00:00` é o dia inteiro.
- Exceção substitui a grade **daquele dia**; o pedaço depois da meia-noite de um intervalo do dia anterior continua valendo.
- Sobreposição: recusada ao salvar, com erro na linha do dia ("Segunda-feira: 08:00–12:00 e 11:00–13:00 se sobrepõem"), inclusive com o que vem da noite anterior. Se mesmo assim existir (dado antigo), o intervalo do próprio dia ganha.
- Fuso: a grade é lida no fuso do quadro (`schedule-clock.ts → localOf/instantOf`). O fuso da empresa (`TenantSettings.timezone`) continua valendo para agenda, relatórios e "data/hora atual" dos fluxos.

### Comportamento da faixa (`behavior`)

| Valor | Na tela | Efeito |
|---|---|---|
| `normal` | Seguir o atendimento normal | Nada é enviado pela faixa |
| `notify_continue` | Enviar a resposta e seguir | Resposta da faixa e depois o atendimento normal (run ativo, gatilhos, fluxos padrão) |
| `notify_stop` | Enviar a resposta e parar | Só a resposta: nenhum fluxo inicia nem recebe a mensagem (run que estava esperando continua esperando) |
| `notify_fallback` | Enviar a resposta só se nenhum fluxo responder | Atendimento normal; a resposta só sai se nenhum fluxo recebeu/assumiu. **É o antigo aviso de fora do expediente** (usado na migração) |

**Resposta** (`reply`): `message` → `items` no formato do bloco Conteúdo (texto com formatação, imagem, vídeo, documento, áudio, intervalo entre mensagens; variáveis `{{contact.*}}`, `{{faixa}}`, `{{proxima_abertura}}` — ex.: "amanhã às 08:00"); `flow` → inicia o fluxo `flowId` (do mesmo cliente, ativo). Resposta `message` sem itens = nada é enviado.

## Comportamento ao receber mensagem

`FlowEngineService.onInbound` (decisão pura em `flows/hours-gate.ts → planInbound`):

1. Resolve a faixa atual do quadro do número (`SchedulesService.now`).
2. **Boas-vindas** (atendimento novo e faixa ≠ "parar") → **resposta da faixa** (`notify_continue`/`notify_stop`) → **atendimento normal** (se não for "parar") → resposta da faixa se ninguém respondeu (`notify_fallback`).
3. `notify_continue` com resposta **fluxo**: o fluxo da faixa assume a mensagem (não passa pelos gatilhos). Se a conversa já está no meio de outro fluxo, o fluxo da faixa **não interrompe** (com "parar", interrompe: substitui o run).

**Envio único por período**: a resposta da faixa sai **uma vez por conversa a cada período daquela faixa**. Período = trecho contínuo da mesma faixa (`periodStartOf`: 08–12 e 12–14 "Aberto" são um só; Fechado de sexta 22h a segunda 08h também, inclusive atravessando feriado). A conversa guarda `scheduleNoticeKey = "<faixa>@<início do período>"`; o motor reivindica com `updateMany` condicional (duas mensagens juntas → um envio só). "Atendimento desativado" é um período próprio por desligamento (`TenantSettings.attendanceChangedAt`). Editar o quadro pode mudar o início do período e fazer a resposta sair de novo.

**Robô pausado** (tarefa 1.5): a **mensagem** da faixa continua saindo (uma vez por período) — a tarefa 2 pediu isso; antes, pausado não recebia nem o aviso. Fluxo da faixa, boas-vindas e atendimento normal não rodam com o robô pausado.

Mensagens automáticas (boas-vindas e faixa) **não criam FlowRun**: não aparecem nas execuções de fluxo (ver memória "aviso não é fluxo"). Saem por `sendAsSystem` (quota, janela de 24h da Meta, ledger de uso); intervalo entre mensagens vira o job `auto-content` na fila `flows`. A resposta da faixa entra depois das boas-vindas com pelo menos 1 s de intervalo (ordem de chegada).

## Boas-vindas

**Cooldown de 6 h** (`WELCOME_COOLDOWN_HOURS`, `planInbound`): quem trocou mensagem com a empresa há menos de 6 h (qualquer conversa do contato) não recebe as boas-vindas de novo — o atendimento segue normal (faixa, fluxos). Mesma saudação de robô repetida para a mesma pessoa é sinal de spam.

`TenantSettings.welcomeEnabled` (liga/desliga sem apagar), `welcomeMessages: WelcomeMessage[]` (`{ id, items: ContentItem[] }`, até 20), `welcomeMode: 'random' | 'sequential'`, `welcomeCursor` (contador atômico do sequencial).

- **Quando**: começo de atendimento — contato novo, conversa criada ou contato voltando depois de encerrado.
- **Com a faixa de horário** (decisão aplicada, a opção recomendada): faixa com **"enviar e parar"** → só a mensagem da faixa (fechado → só a mensagem de fechado); demais faixas → **boas-vindas primeiro**, depois a mensagem da faixa (se houver), depois o fluxo de entrada.
- **Com o fluxo de entrada** (fluxo padrão "Fluxo de boas-vindas", gatilho "nova conversa"): os dois rodam — as mensagens de boas-vindas saem antes do fluxo. Para não duplicar o cumprimento: a migração `20261005010000_welcome_enabled` deixa `welcomeEnabled = false` para quem já tinha Fluxo de boas-vindas **ativo**, e a tela de Boas-vindas avisa quando as mensagens estão ligadas (e preenchidas) junto com o Fluxo de boas-vindas ativo.

## Integração com fluxos

- **Renomear faixa**: ao salvar o quadro, cada faixa que mudou de nome (mesmo id) tem o nome trocado nas regras "Faixa de horário atual" de **todos os fluxos da empresa** (`renamedBands` + `renameBandInDefinition`, shared). Não troca se outro quadro ainda tem uma faixa com o nome antigo (as regras continuam valendo para ele). A resposta traz `renamedConditions` e a tela informa quantas foram alteradas. Cada fluxo alterado tem a **versão incrementada**: um editor aberto com a versão antiga recebe 409 ao salvar e é convidado a recarregar, em vez de desfazer a troca (ver [Fluxos › Controle de versão](fluxos.md#controle-de-versão-ao-salvar)).
- **Faixa inexistente**: card da Condição e painel da regra mostram em vermelho quando a faixa citada não existe em nenhum quadro (a regra nunca casa). Não impede salvar.
- **Condição**: `business_hours` ("Dentro do horário de atendimento") = faixa atual com `open` no quadro do número da conversa (atendimento desativado = fora). Regra antiga com `hours` próprio continua igual (`business-hours.ts → isOpenAt`). Novo operando `schedule_band` ("Faixa de horário atual", `band` = **nome** da faixa ou `closed`; comparado sem maiúsculas/acentos — pelo nome porque cada número pode usar outro quadro).
- **Atraso inteligente**: "até o próximo horário de atendimento" e "só seguir no horário" usam `SchedulesService.nextOpen` (faixas com `open`). Atendimento desativado ou quadro que não abre em 14 dias → segue na hora.
- **Salvar e Menu**: `timeoutBusinessHours` ("Contar só dentro do horário de atendimento") → `waitUntil = addOpenMinutes(...)`. Atendimento desativado → tempo corrido.
- **Disparos** ("só no horário"): quadro do número da campanha.

## API

`/settings` (permissão `settings.manage` para alterar):

| Método | Rota | O quê |
|---|---|---|
| GET | `/settings` | Configurações + `isOpenNow`, `currentBand`, `nextOpenLabel` (quadro padrão) |
| PATCH | `/settings` | Também `welcomeMessages`, `welcomeMode` |
| GET | `/settings/schedules` | Quadros (com os números que usam cada um) |
| POST | `/settings/schedules` | `{ name, timezone?, config?, copyFromId? }` — primeiro do cliente nasce padrão; sem `config` = seg–sex 08–18 |
| PUT | `/settings/schedules/:id` | `{ name?, timezone?, config? }` — valida (`validateSchedule`, mensagens no formato do Conteúdo, anexo do próprio cliente, fluxo do cliente) |
| DELETE | `/settings/schedules/:id` | Não exclui o padrão; números que usavam voltam ao padrão |
| POST | `/settings/schedules/:id/default` | Torna padrão |
| PUT | `/settings/numbers/:numberId/schedule` | `{ scheduleId: string \| null }` |

Removido: `PUT /settings/business-hours` e o campo `outsideHoursText`.

## Editor (`apps/web/src/components/settings/`)
- `ScheduleSection.tsx`: modal "Novo quadro" (nome; cópia do selecionado ou do zero), chave "atendimento ativo", abas dos quadros, faixas (cor, nome, conta como atendimento, comportamento, resposta mensagem/fluxo), Fechado, grade com **Copiar** (escolhe os dias), exceções, erros por linha, **Simular** (dia + hora → faixa, comportamento, período, próxima abertura e prévia da resposta, com o rascunho, sem salvar), quadro por número, fuso da empresa.
- `WelcomeSection.tsx`, `AutoContent.tsx` (reaproveita o `ContentPanel` do Conteúdo).

## Compatibilidade (migração `20261005000000_business_schedules`)

Para cada cliente com configurações ou expediente: quadro **"Horário padrão"** (padrão, fuso da empresa) com a faixa **"Aberto"** (`normal`):
- cada intervalo antigo vira um intervalo "Aberto";
- intervalo antigo que virava a meia-noite (`18:00–02:00`) valia no **mesmo** dia da semana 00:00–02:00 e 18:00–24:00 → é dividido nesses dois pedaços (resultado idêntico);
- cliente sem intervalo (era "sempre aberto") → todos os dias `00:00–00:00` (24h);
- `outsideHoursText` vira a mensagem de **Fechado** com `notify_fallback` (sai exatamente quando o aviso antigo saía);
- `business_hours` e `outsideHoursText` são removidos.

Diferenças conhecidas para quem não mexer em nada: o aviso antigo saía **uma vez por conversa para sempre**; agora sai **uma vez por período** de fechado (pedido da tarefa) — conversas que já receberam o aviso recebem de novo no próximo período fechado. E com o robô pausado o aviso agora sai.

## Testes
`apps/api/test/schedule.test.ts`: vários intervalos no mesmo dia, virada da meia-noite, exceções, fuso, chave de período (envio único), próxima abertura, tempo só no horário, validação (sobreposição), a matriz de comportamento (`planInbound`) e a renomeação de faixa nas condições. Faixa na Condição: `flow-conditions.test.ts`.
