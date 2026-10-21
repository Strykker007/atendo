# Histórico de mensagens anteriores ao painel

Quem conecta um número que já atendia pelo celular quer ver a conversa inteira, não só o que
chegou depois de ler o QR. O painel busca esse passado **sob demanda**, enquanto o atendente
rola a conversa para cima. Não há importação em massa.

Só funciona em número **Evolution (QR)**. A Evolution guarda no próprio banco tudo o que
passou pelo aparelho desde o pareamento, inclusive o lote de histórico que o WhatsApp manda ao
ler o QR. Em produção há números com mensagens desde 2023. A API oficial da Meta só entrega o
que chega pelo webhook: lá não há o que buscar (`fetchHistory` não existe no adapter).

## Como funciona

1. `GET /conversations/:id/messages` devolve a página do banco (50).
2. Página incompleta = chegou ao começo do que temos. O controller chama
   `HistorySyncService.syncOlder(tenant, conversa, faltam)`.
3. O serviço pega a mensagem **mais antiga** da conversa (`before`) e pede ao provider
   `fetchHistory({ phone, before, limit, knownExternalIds })`.
4. A Evolution (`POST /chat/findMessages`) é consultada para cada forma do chat: telefone
   com e sem o nono dígito (`phoneVariants`) e o `@lid`, descoberto pelas mensagens que já
   temos (`storedRemoteJid` com o id de uma recebida e de uma enviada). Junta, tira repetidas
   e descarta o que não é bolha: reação, edição (`protocolMessage`), evento cifrado, grupo e status.
5. `InboundService.importHistory` grava o que faltar e o controller relê a página. O front não
   muda nada: a paginação por cursor continua e a próxima rolagem continua de onde parou.

Lote só com o que é descartado (ex.: 50 reações) não trava a rolagem: o serviço repete até
3 vezes, a partir do registro mais antigo lido (`HistoryPage.oldest`).

## Cuidados

| Risco | Como é evitado |
|---|---|
| Duplicar mensagem | `externalId` é único: confere antes e grava com `skipDuplicates`. Trava no Redis por conversa (`wa:history:lock:<id>`, 20 s): duas abas não sincronizam juntas |
| Disparar automação | Não passa pelo caminho do webhook: nada de fluxo, boas-vindas, agenda, pesquisa, descadastro |
| Bagunçar a conversa | Não mexe em não-lidas, espera, prévia, status, `lastInboundAt` (janela de 24h) nem no socket |
| Cobrar o passado | **Não** passa por `UsageService.record`. É a exceção à regra do ledger: não é mensagem enviada nem recebida agora |
| Distorcer relatórios | Coluna `messages.imported = true`. Contagem de mensagens, mensagens por atendimento e tempo de primeira resposta ignoram as importadas |
| Alarme de recebimento parado | Importada entra como `delivered`; `sent` sem recibo dispararia o `receive-stall` |
| Desfazer "Limpar histórico" | Conversa com evento `history_cleared` nunca sincroniza |
| Travar a tela | Prazo de 3 s: passou, mostra o que tem e a busca termina em segundo plano. Erro da Evolution = página do banco, sem erro na tela |
| Sobrecarregar a Evolution | No máximo **4 buscas ao mesmo tempo** somando todas as contas (`wa:history:running` no Redis, vaga vence junto com a trava de 20 s). Cheio: a conversa abre com o que tem e a próxima rolagem tenta de novo. O identificador do chat (`@lid`/telefone) é descoberto uma vez por busca e reaproveitado nas rodadas seguintes (`HistoryPage.chatIds`). Sem teto, a equipe abrindo conversa de manhã levou o servidor a 100% de CPU em 16/10/2026 |
| Perguntar à toa | Provider sem nada mais antigo (ou Meta) → marca `wa:history:end:<id>` por 3 dias |
| Lotar storage e travar a requisição com mídia | Mídia vai para a fila `wa-history-media` (2 por vez, 2 tentativas). Mídia antiga que já saiu do servidor do WhatsApp fica "indisponível", como uma recebida que falhou |

Citação: resolve para a mensagem citada quando ela está no mesmo lote ou já no banco; fora
disso fica o `quotedId`/prévia, como em qualquer mensagem. Mídia de **status** citado não é
buscada (o story já sumiu).

## Limitações

- Só preenche **para trás** (antes da mais antiga que temos). Um buraco no meio (webhook perdido
  com a Evolution fora do ar) não é preenchido.
- Reação e edição feitas no passado não são aplicadas às mensagens importadas.
- Mídia antiga (na prática, mais de ~30 dias) já saiu do servidor do WhatsApp e a Evolution não
  guarda o arquivo, só a referência: a bolha mostra "[Áudio antigo · o WhatsApp não guarda mais o
  arquivo]". Mídia recente do histórico baixa normalmente.
- O quanto existe depende do que o WhatsApp mandou no pareamento. Para trazer mais, o número
  teria que ser pareado de novo com `syncFullHistory` (hoje desligado em todas as instâncias).

## Recuperação

Às vezes o WhatsApp **não entrega ao vivo** o que o contato escreveu: o número fica "conectado,
envia, não recebe" (docs/23-evolution-desempenho.md › 10 e 12) ou fora do ar. O celular da loja
recebe; o painel não. Quando o número é pareado de novo, essas mensagens chegam ao banco da
Evolution no lote de histórico do QR, que **não** gera webhook. Sem recuperação, elas nunca
apareciam nas conversas do Atendo (Balneário, 21/10/2026: 139 mensagens de 15 clientes em 29 min).

**Quando roda:** o `InboundService` agenda a fila `wa-gap-recovery` quando um número Evolution
volta a `connected` (QR lido ou reconexão depois de queda) e quando um número marcado "parou de
receber" dá sinal de vida. Duas rodadas, 3 e 15 min depois (`GAP_RECOVERY_DELAYS_MS`), porque o lote
do QR leva minutos para chegar. Reconexões no mesmo minuto não empilham rodadas.

**O que faz** (`whatsapp/gap-recovery.ts` → `InboundService.recoverGap`):
1. Lê do banco da Evolution tudo das últimas 24h do número, de todos os chats
   (`EvolutionProvider.fetchRecent`, até 40 páginas de 100). Grupos, status, reações e edições ficam
   de fora (os mesmos filtros do histórico).
2. Chat gravado só como `@lid` ganha o telefone de outra mensagem do mesmo chat que a Evolution
   gravou com `remoteJidAlt`. Sem nenhuma, a mensagem é descartada e contada no log: criar contato
   com o LID no lugar do telefone abriria uma conversa fantasma.
3. Descarta o que já está no banco (`externalId` por número, inclusive mensagem apagada no
   painel), o que é anterior a uma limpeza de histórico da conversa e o eco de mensagem enviada
   pelo painel cujo id nunca chegou (liga o id em vez de duplicar).
4. Grava o restante no lugar certo (`createdAt` = horário do WhatsApp), como tráfego real:
   `imported = false` (conta nos relatórios) e `UsageService.record` em cada uma.

**"Histórico + alerta"** (`conversations/gap-recovery-plan.ts`): a conversa só se mexe se a
recuperada for mais nova que tudo o que ela já tem. Uma mensagem das 13:20 numa conversa que já
falou às 13:40 entra no histórico e não traz a prévia de volta nem reabre um atendimento encerrado
depois. Se o fim da linha ficou sendo o cliente sem resposta: soma as não lidas, marca a espera e,
se estava encerrada, volta para a fila (mesma carência de "ok"/"obrigada" da entrada ao vivo). Se
o fim é uma resposta dada pelo celular, a espera acaba. **Nunca** dispara fluxo, bot ou boas-vindas:
uma resposta automática meia hora atrasada seria pior que nenhuma.

O log do worker registra cada recuperação: `Número <label>: N mensagem(ns) recuperada(s) em M
conversa(s)`, mais as descartadas por `@lid` e o aviso de janela truncada.

Limitação: o que o WhatsApp não mandou nem no lote do QR (travamento curto, sem novo pareamento)
não existe na Evolution e não tem como ser recuperado.
