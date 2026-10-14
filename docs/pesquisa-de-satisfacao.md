# Pesquisa de satisfação (CSAT / NPS)

Pergunta enviada ao cliente pelo WhatsApp **quando o atendente encerra o atendimento**. A nota
fica ligada ao consultor que atendeu e alimenta o relatório de satisfação.

- Tela de cadastro: menu **Pesquisas** (`/pesquisas`, permissão `settings.manage`).
- Relatório: **Relatórios → Satisfação** (`/relatorios/satisfacao`, permissão `reports.view`).
- Código: `apps/api/src/modules/satisfaction/` (`survey-runner.service.ts` = envio e leitura da
  resposta; `satisfaction.module.ts` = CRUD e relatório), regras puras em
  `packages/shared/src/satisfaction.ts`.

## Por que não é um fluxo

O encerramento já dispara fluxo (`onCloseFlowId`/`wonFlowId`/`lostFlowId`), mas o fluxo de
encerramento **reabre a conversa** para poder falar (`startOnClose` põe em `waiting`). Na pesquisa
isso devolveria para a fila um atendimento que acabou só porque o cliente deu uma nota. Aqui a
conversa continua **encerrada** do envio ao "obrigado": as mensagens saem com
`sendAsSystem(..., { allowClosed: true })` e a resposta entra no histórico sem reabrir.

Com pesquisa no encerramento, o fluxo de encerramento **não roda** (o modal desabilita o seletor
e a API ignora): duas automações perguntando ao mesmo tempo confundem o cliente.

## Escalas

| `scale` | Como o cliente responde | Indicadores |
|---|---|---|
| `scale_5` | digita 1 a 5 | média, % satisfeitos (4–5) |
| `scale_10` | digita 1 a 10 | média, NPS (% 9–10 − % 1–6), % promotores |
| `csat_3` | toca em **Ruim / Neutro / Bom** (botões) ou escreve a palavra | % "Bom" (CSAT) |

A instrução de como responder é acrescentada pelo sistema (`surveyPromptText`), então a prévia da
tela é exatamente o que sai. As notas vão só como texto: 10 notas + recusa não cabem numa lista
da Meta, e no QR (Evolution) os botões viram lista numerada, que embaralharia "1 - 1", "2 - 2". Na
CSAT de 3 pontos a ordem dos botões é Ruim (1), Neutro (2), Bom (3), Não responder (4), então o
número digitado no QR também vale.

Aceito como nota (`parseSurveyAnswer`): toque no botão, `8`, `nota 8`, `8/10`, `8!`, `5 estrelas`;
na CSAT, `bom`, `ótimo`, `regular`, `péssimo`…

## Perguntas adicionais

Além da principal, até **2** perguntas (`extraQuestions`, `SURVEY_EXTRA_QUESTIONS_MAX`), cada uma
com a sua escala. Ordem: principal → 2ª → 3ª → comentário (se ligado) → agradecimento.

- **Uma por vez**: a próxima só sai depois que o cliente responde a anterior. Cada resposta do
  cliente gera **no máximo uma** mensagem de volta (nunca "obrigado" + pergunta seguidos).
- **"0" numa adicional** pula o resto: a nota principal fica e sai o agradecimento.
- **Outra coisa numa adicional** (pergunta, áudio): a pesquisa fecha com o que já foi respondido
  (`answered`) e a mensagem reabre o atendimento — sem insistir.
- As adicionais ficam **congeladas na resposta** no envio (`SurveyResponse.questions`): editar a
  pesquisa no meio não muda o que o cliente vai receber. As notas vão em `answers`
  (`[{questionId, question, scale, score}]`); `step` diz em qual pergunta está.
- O relatório principal (média, NPS, por consultor) é da **pergunta principal**; as adicionais
  aparecem em *Outras perguntas*, cada uma com média/% satisfeitos e distribuição.

## Anti-bloqueio

Toda mensagem da pesquisa sai por `sendAsSystem` **sem autor**, então é **automática** para o
`SendPacer` e respeita tudo que vale para fluxo e boas-vindas ([Envio](envio.md)): intervalo do
número (mínimo 3 s no QR), folga extra de automáticas, teto de **automáticas por hora** do
número, rajada por conversa e expiração da fila. Nada é enviado em lote: no máximo 3 perguntas +
comentário + agradecimento, cada um como resposta a uma mensagem do cliente, dentro da janela
de 24 h que ele mesmo abriu.

## Recusa e "sem insistência"

- **Recusar**: `0`, "não responder", "pular", "não quero"… ou o botão *Não responder*. A pesquisa
  termina na hora (`declined`) e sai só a *resposta à recusa*, se configurada.
- **Mandou outra coisa** ("e o frete?", áudio, foto): a pesquisa sai do caminho (`expired`) e a
  mensagem reabre o atendimento como qualquer outra. Ninguém pergunta de novo.
- **Prazo** (`expiresHours`, padrão 24 h, máx. 168): depois dele a mensagem do cliente segue o
  caminho normal. Não há reenvio nem lembrete.
- **Comentário** (opcional, `askComment`): depois da nota, pede um comentário. Texto vira
  comentário; `0`/"não"/"ok" fecha sem comentário; mídia fecha a pesquisa (a nota fica) e reabre o
  atendimento. Prazo vencido com nota dada = `answered` sem comentário.

## Estados (`SurveyResponse.status`)

`pending` (esperando nota) → `commenting` (nota dada, esperando comentário) → `answered`;
ou `declined`, `expired`, `failed` (não saiu: número desconectado, fora da janela de 24 h da
Meta, contato descadastrado ou sem WhatsApp — o encerramento não trava por isso).

A linha nasce **antes** do envio (o cliente pode responder antes de o worker confirmar). Uma
pesquisa nova na mesma conversa expira a anterior que ainda estivesse aberta.

## Onde a resposta é interceptada

`InboundService.ingestInbound`: com a conversa encerrada (decisão `reabrir`), chama
`SurveyRunnerService.claim` **antes** de decidir reabrir. Se a mensagem é resposta da pesquisa,
ela entra como "quieta" (não reabre, não dispara fluxo, boas-vindas nem agenda) e o
`InboundProcessor` chama `followUp` — pede o comentário, agradece ou responde à recusa. Toda
mensagem passa pelo `UsageService` como qualquer outra (entrada no ingest, saída no worker).

## Disparo no encerramento

`PATCH /conversations/:id/status` com `status: closed` aceita `surveyId`:

- ausente → a pesquisa **padrão** da empresa (`isDefault`), se houver;
- `null` → não envia;
- id → essa pesquisa (inválida/desativada = 400 **antes** de encerrar).

Encerramento interno nunca envia. O encerramento em massa não envia (fica para uma próxima).
O consultor gravado na resposta é o **dono da conversa antes de encerrar**; sem dono, quem
encerrou. Fica congelado (`agentId` + `agentName`), assim como a escala (`scale`): editar a
pesquisa depois não reescreve notas que já entraram.

No modal de encerramento, a opção **Enviar pesquisa de satisfação ao encerrar** vem marcada quando
há pesquisa padrão; com mais de uma ativa, aparece o seletor.

## Relatório

`GET /reports/satisfaction` — ver [07 — API](07-api.md). Base: pesquisas **enviadas** no período
(`sentAt`), sem as `failed`. Escalas diferentes não se misturam numa média: sem `scale`, vale a
mais usada no período, e a tela mostra as outras para trocar.

- **Taxa de resposta** = notas ÷ enviadas. **Recusas** = `declined` ÷ enviadas. *Sem resposta* =
  enviadas − notas − recusas − aguardando (ainda no prazo).
- **Por consultor**: os mesmos indicadores agrupados pelo consultor congelado. Clicar na linha
  filtra os feedbacks.
- **Feedbacks**: respostas com nota, filtráveis por nota, consultor e "só com comentário",
  paginadas; o nome do contato abre a conversa.

## Modelo de dados

`satisfaction_surveys` (configuração, com `extraQuestions`; excluir = desativar, no máximo uma `isDefault` por empresa,
até 20 ativas) e `survey_responses` (uma por envio). Migrações `20261127000000_satisfaction_surveys` e `20261129000000_survey_extra_questions` (`extraQuestions`, `step`, `questions`, `answers`).
