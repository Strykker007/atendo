# 14 — Qualidade e observabilidade

Duas redes de proteção para rodar na casa do cliente: **testes** (evitam que um bug chegue lá)
e **observabilidade** (quando chegar, você descobre antes do cliente ligar).

## Testes

Rodar:

```bash
pnpm test                          # tudo (é o que o CI roda)
pnpm --filter @atendo/api test:watch
```

Runner: **Vitest**, em `apps/api/test/`. Os testes são **unitários e offline**: não sobem
Postgres, Redis, fila nem rede. `test/setup.ts` só preenche as variáveis que `config/env.ts`
exige na importação, e `TZ=UTC` fixa o fuso para o resultado ser igual no seu Mac e no CI.

Por que estes arquivos e não outros: são os pontos onde um erro **custa dinheiro, manda
mensagem errada para o cliente final ou marca dois clientes no mesmo horário**.

| Arquivo | O que protege |
|---|---|
| `meta.provider.test.ts` | Leitura do webhook da Meta (texto, botão, lista, mídia, anúncio, status), validação da assinatura HMAC e montagem do envio — inclusive os limites da Meta (≤3 opções viram botões, 4–10 viram lista, título de botão em 20 caracteres) |
| `evolution.provider.test.ts` | Leitura do webhook da Evolution (tipos de mídia, `fromMe`, grupos, acks, `connection.update` com logout 401 e estado transitório), autenticação por token da instância e envio (texto, menu numerado, áudio PTT, mídia em base64, shard) |
| `scheduling-time.test.ts` | Conversão de fuso: virada de dia, dia da semana, horário de verão, fuso do tenant ≠ fuso da máquina |
| `scheduling-slots.test.ts` | Disponibilidade: passo, duração que não cabe, colisão com agendamento, horário no passado, vários intervalos no dia, limite do menu |
| `flow-answer.test.ts` | Como o contato escolhe: id do botão, número, texto exato/parcial — e o que **não** pode ser aceito como escolha |
| `quota.test.ts` | Quota: dentro do incluído, excedente cobrado, limite rígido, assinatura suspensa, fronteira exata |
| `reports-dsl.test.ts` | A DSL de relatórios recusa métrica/agrupamento fora da lista e tentativa de injeção de SQL |

### Como escrever um teste aqui

A lógica testável foi isolada em módulos **puros**, sem Nest nem Prisma — é isso que permite
testar sem subir nada:

- `modules/scheduling/time.ts` — conversões de fuso
- `modules/scheduling/slots.ts` — `computeSlots` (o serviço só busca os dados e delega)
- `modules/flows/answer.ts` — `choose`, `validAnswer`, `interpolate`
- `modules/billing/quota.ts` — `decideCanSend`

Ao criar uma regra de negócio nova que dê para errar, **coloque-a num módulo puro e teste lá**,
em vez de deixá-la no meio de um método que precisa de banco. Para os adapters, o padrão é
gravar um payload real do provider (reduzido ao que o adapter lê) e afirmar sobre o resultado
do `parseWebhook`; para envio, `vi.stubGlobal('fetch', ...)` e afirmar sobre o corpo montado.

O `pnpm typecheck` também cobre `test/` — teste que não compila quebra o CI.

## Observabilidade

_(seção escrita junto com a implementação — ver abaixo)_
