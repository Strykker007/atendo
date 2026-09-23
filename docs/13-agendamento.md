# 13 — Agendamento (barbearias, salões, clínicas)

Funcionalidade **plugável no plano** (`features: ['scheduling']` — Pro e Business no seed). Menu **Agenda**.

## Conceitos

| | |
|---|---|
| **Profissional** | Quem atende (barbeiro). Tem **horários de trabalho** por dia da semana (vários intervalos = pausas), cor na agenda e **WhatsApp** (recebe o aviso do próximo cliente) |
| **Serviço** | Nome, **duração** (define o tamanho do horário) e preço |
| **Agendamento** | Contato + profissional + serviço + início/fim. Status: `scheduled` → `confirmed` (cliente confirmou no lembrete) → `done` / `no_show`; ou `canceled`. `source`: `flow` (robô), `panel` (chat/agenda) |
| **Preferências** | Intervalo dos horários (30 min), lembretes ao cliente (`[1440, 60]` min antes), aviso ao profissional (15 min), número que envia, fuso (`America/Sao_Paulo`), dias à frente que o robô oferece (7) |

Serviço e profissional são **obrigatórios** em toda marcação (dá duração certa e relatório).

## Três formas de marcar, uma agenda

1. **Pelo WhatsApp (robô)** — bloco **Agendar horário** no editor de fluxos: pergunta o serviço (menu numerado), o profissional (pula se só houver um ou se estiver fixo no bloco), mostra os próximos horários livres ("mais" para ver outros), confirma (botão ou 1/2) e cria. Saídas: *Agendou* / *Não conseguiu*. O contato pode responder "cancelar". Depois disso ficam disponíveis `{{agendamento}}`, `{{servico}}`, `{{profissional}}`.
2. **Pelo chat** — botão **Agendar** no cabeçalho da conversa (contato já preenchido).
3. **Pela Agenda** — botão *Agendar* com busca de contato (só quem já conversou).

Todas usam a mesma disponibilidade: dentro dos horários de trabalho, passo = intervalo configurado, cabe a duração do serviço, sem colisão com agendamentos ativos, nunca no passado. O conflito também é checado **na gravação** (duas pessoas escolhendo o mesmo horário → a segunda recebe "acabou de ser ocupado").

## Lembretes (job a cada minuto, `RemindersProcessor`)

| Para | Quando | Texto |
|---|---|---|
| Cliente (véspera) | 1440 min antes | "Você tem *Corte* com Carlos marcado para seg. 21/09 09:00. Posso confirmar?" + opções **Confirmar** / **Remarcar** |
| Cliente (perto) | 60 min antes | "Lembrete: seu horário … é hoje às 09:00" |
| **Profissional** | 15 min antes | "💈 Próximo: *Bruno* às 09:00 — Corte + barba (45 min). Cliente há 3 visitas, última em 02/09 (Corte). Obs.: … ✅ Confirmado pelo cliente." |

Resposta ao lembrete (`SchedulingService.onInbound`, roda **antes** dos fluxos): **Confirmar** → `confirmed` + mensagem de confirmação; **Remarcar** → marca "pediu remarcação", avisa o cliente, devolve a conversa para a fila com **nota interna** para a equipe remarcar pela Agenda.

Vale tanto o toque no botão (Meta) quanto **1**/**2** ou a palavra exata (Evolution). A leitura é
deliberadamente estrita (`reminder-reply.ts`), porque roda em **toda** mensagem recebida: um
"bom dia" ou um "quero remarcar meu horário" **não** contam como resposta — quem cuida
desses casos é o atendente ou um fluxo.

O aviso ao profissional vai pelo número da barbearia para o WhatsApp dele (`sendToPhone`): cria um contato/conversa para ele que fica **encerrada** (não polui a fila). Sem WhatsApp cadastrado, não há aviso (a tela mostra isso em laranja).

## Telas

- **Agenda** — dia por profissional, navegação por dia/semana com contagem, filtro por profissional. Cada horário: status, serviço, obs., "🤖 pelo WhatsApp", "pediu remarcação"; ações **Atendido / Faltou** (após o horário), **Remarcar**, **Cancelar**, **Conversa**.
- **Agenda → Profissionais e serviços** — CRUD (desativar preserva histórico), horários por dia com múltiplos intervalos, preferências de lembretes.
- **Chat** — botão *Agendar* e ficha "💈 3 visitas · última 02/09 · Próximo: seg. 21/09 09:00 · Corte com Carlos ✅".

## API (`/scheduling/*`, exige feature)

| Método | Rota | Descrição |
|---|---|---|
| GET/PATCH | `settings` | Preferências |
| GET/POST/PATCH/DELETE | `professionals[/:id]` | `hours: [{weekday, start, end}]` substitui todos; DELETE = desativa |
| GET/POST/PATCH/DELETE | `services[/:id]` | |
| GET | `availability?professionalId&serviceId&from&days` | `[{startAt, endAt, label}]` |
| GET | `appointments?from&to&professionalId&contactId` | |
| POST | `appointments` | `{professionalId, serviceId, contactId, startAt, conversationId?, notes?}` — 409 em conflito |
| PATCH | `appointments/:id` | `status`, `startAt` (remarcar zera lembretes), `professionalId`, `serviceId`, `notes` |
| GET | `contacts/:contactId` | `{visits, last, upcoming}` |

Evento socket `appointment` → telas recarregam.

## Fuso horário

Tudo é guardado em UTC; horários de trabalho e rótulos usam o fuso do tenant via `Intl` (independente do servidor). Horário de verão é tratado por instante.

## Próximos passos possíveis

Bloqueios de agenda (folga, feriado) · serviços por profissional · relatório de faltas e receita prevista · lembrete de retorno ("faz 30 dias do último corte") · pagamento/sinal antecipado.
