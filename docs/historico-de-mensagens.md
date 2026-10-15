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
| Travar a tela | Prazo de 8 s: passou, mostra o que tem e a busca termina em segundo plano. Erro da Evolution = página do banco, sem erro na tela |
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
