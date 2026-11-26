# Notas internas

Nota interna ("cadeado") é a orientação da equipe dentro da conversa: só a equipe vê, nunca vai ao WhatsApp e não conta no uso. API em [07-api](07-api.md) (`POST /conversations/:id/notes`).

## Avisos

Ao gravar, recebem o aviso (cartão fixo + som, evento `note_alert`):

- quem está com o atendimento (sem dono, aguardando ou encerrada: quem atendeu por último, ou seja, assumiu, recebeu a transferência ou encerrou);
- quem já escreveu nota nesta conversa nos últimos 30 dias (a resposta chega a quem perguntou);
- os citados com `@Nome`;
- com `@todos`/`@equipe`, quem atende pelo número da conversa.

Quem escreveu nunca recebe, e citado que não atende por aquele número também não.

**Sugestão ao digitar `@`** (`components/chat/MentionSuggest.tsx`, `useMention`): no campo da nota aparece a lista da equipe ativa e *Todos*, filtrada pelo que vem depois do `@` (sem acento, por qualquer palavra do nome). Setas escolhem, Enter ou Tab insere e Esc fecha. Entra o primeiro nome ou, quando dois da equipe têm o mesmo primeiro nome, o nome completo, senão o aviso iria para os dois.

## Imagem

A nota pode levar **uma imagem**, para o gestor mandar um print do atendimento e a pessoa citada ver o que aconteceu. Ela entra de três jeitos: pelo botão 🖼 do campo da nota, **colando com Ctrl+V** (um print copiado vira a imagem da nota, não texto) ou arrastando o arquivo para o campo. **Marcar antes de enviar** (`components/chat/ImageMarkup.tsx`): a imagem abre num editor em tela cheia com:
- caneta, retângulo e seta;
- 6 cores e 3 espessuras (proporcionais ao tamanho da imagem);
- desfazer (Ctrl+Z), limpar e descartar (Esc).

"Concluir" usa a imagem como está, com ou sem marcas. Tudo acontece no navegador e só a versão marcada sobe. A imagem é reduzida a 2000 px no lado maior; foto continua JPEG e print continua PNG. Depois, a miniatura mostra **Marcar** (reabre o editor sobre o arquivo local, sem baixar do storage) e ✕ (tira a imagem). O texto é opcional quando há imagem.

- **Upload:** `POST /uploads`, o mesmo da mídia do chat. A nota manda `mediaKey`/`mediaMime`/`mediaName` no `POST /conversations/:id/notes`.
- **Regras da API:** a chave precisa ser do storage do próprio cliente (`media/<tenantId>/`), e na nota só entra `image/*`. O limite na tela é 10 MB. A mensagem fica com `type: image` e `internal: true`.
- **O que não muda:** a imagem nunca vai ao WhatsApp e não conta no uso.
- **Avisos:** nota só com imagem chega nos avisos como "📷 Imagem".
- **Onde aparece:** no balão da nota, a imagem fica acima do texto e o clique amplia no visualizador do chat. Também aparece na auditoria de atendimentos e nas mensagens de um feedback.

## Leitura

Cada pessoa avisada ganha uma linha em `note_receipts` (`messageId`, `userId`, `userName`, `readAt`), inclusive quem está offline. Com isso:

- **Quem escreveu vê no balão da nota** quem precisa ler: "Bruno · não leu" ou "Bruno · lida 26/11 14:32". Nota sem ninguém avisado diz "Ninguém foi avisado — cite com @Nome".
- **Abrir a conversa = ler**: o `ChatPane` chama `POST /conversations/:id/notes/read` quando há nota para a pessoa sem `readAt`. A API marca as notas e reemite as mensagens (`message`), e o autor vê a mudança na hora.
- **Selo na lista e no Kanban**: a conversa com nota para a pessoa ainda não lida ganha o selo âmbar piscando 🔒 *Nota* (com a contagem), ao lado das não lidas (`SeloNota` em `ConversationList`, lido do cache `['attention']`, atualizado pelo `note_alert`). O selo sai ao abrir a conversa. Assim, quem dispensou o cartão não perde a nota de vista.
- **Quem não estava online** recebe as notas não lidas como cartão ao entrar (`GET /reviews/attention` → `notes`, até 3 cartões, uma vez por sessão do navegador).

A lista de leitura sai junto da mensagem (`noteReceipts` no `MESSAGE_INCLUDE`). Mensagem comum tem a lista vazia.

Para correção de conduta que precisa de ciência garantida, use o [feedback de atendimento](feedback-de-atendimento.md). A nota interna é passagem de bastão dentro da conversa.
