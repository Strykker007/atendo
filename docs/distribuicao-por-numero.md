# Quem recebe automaticamente (por número)

**Ver** uma conversa e **receber** uma conversa sozinho são coisas diferentes. Antes, a fila de
atendimento, o bloco Distribuidor e a redistribuição escolhiam, entre todos que **enxergam** o
número, quem tinha menos atendimentos abertos. Na prática o gerente (que vê tudo para supervisionar)
recebia atendimento da portaria só por estar com a mesa vazia.

## Como funciona

Configura-se por pessoa em **Equipe → Acesso → Recebe auto.** (só o admin da conta); em **Números** cada número mostra o resumo "Recebe automaticamente" (só leitura):

| Configuração | Quem recebe da fila / Distribuidor / redistribuição |
|---|---|
| Ninguém marcado (padrão) | todos que enxergam o número, como antes |
| Pessoas marcadas | só elas (e só se também enxergarem a conversa: número, empresa e departamento) |

E, se a conversa tem **departamento** (com alguém nele), só quem **é do departamento** recebe sozinho —
"ver todas as conversas" (`view_all`) não basta: serve para enxergar e assumir na mão. Mesma régua do
bloco Distribuidor. Ordem dos filtros: enxerga a conversa → está na lista do número (se houver) → é do
departamento da conversa (se houver) → disponível e abaixo do limite → menos atendimentos abertos.

Quem fica de fora **continua vendo** as conversas e pode assumir ou transferir na mão. A
transferência manual não muda (régua de quem enxerga).

Exemplo (condomínio): Portaria → porteiros; Concierge → concierge; Administração → administração.
Gerente e síndico veem tudo e não recebem nada sozinhos.

**Não há escalonamento automático**: se ninguém da lista está disponível (offline, pausa, no limite
da fila), a conversa espera em Aguardando até alguém da lista voltar ou alguém de cima assumir na
mão. Decisão do produto (11/11/2026): o gerente não deve pegar portaria só porque o porteiro saiu
um minuto. Níveis com subida por tempo ficaram para depois, se aparecer a necessidade.

## Onde é aplicado

| Ponto | Como |
|---|---|
| Fila de atendimento (`attendance-queue`) | `ConversationsService.autoReceiversOf` |
| Redistribuição automática (`auto-reassign`) | `autoReceiversOf` |
| Bloco Distribuidor do fluxo | lista do número, **só quando o bloco não tem atendentes escolhidos** (atendentes escolhidos no bloco são decisão de quem montou o fluxo) |
| Transferência manual | não se aplica (`receiversOf`) |
| [Saiu do plantão](redistribuicao-automatica.md#saiu-do-plantão) | não se aplica: devolve para Aguardando sempre, mesmo sem ninguém da lista |

## API e banco

- `GET /numbers` devolve `receiverIds` por número.
- `PUT /numbers/:id/receivers` `{ userIds }` — admin da conta (ou dono entrando como). Recusa (400)
  quem não enxerga o número: estaria na lista e nunca receberia.
- Tabela `number_receivers` (`numberId`, `userId`, cascata ao apagar um ou outro), migration
  `20270209000000_number_receivers`. Sem linhas = comportamento anterior.
- Tela: `components/settings/AccessModal.tsx` (edição, por pessoa — `receiveNumberIds` no PATCH da pessoa) e `components/numbers/NumberReceivers.tsx` (resumo). `PUT /numbers/:id/receivers` continua existindo para integrações.
