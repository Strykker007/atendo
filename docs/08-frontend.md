# 08 — Front-end

Next.js 15 (App Router), React 19, Tailwind, TanStack Query, Zustand, Socket.IO client, lucide-react.

## Layout

```
┌──────────┬────────────────┬──────────────────────────┬──────────────┐
│ Sidebar  │ ConversationList│ ChatPane                 │ QuickReplies │
│ (menu)   │ número ▾        │ contato · tags · encerrar│ pastas       │
│ recolhe  │ [Aguard|Em|Enc] │ ┌──────────────────────┐ │  └ respostas │
│ p/ ícones│ busca / tags    │ │ bolhas estilo WhatsApp│ │              │
│          │ ─────────────── │ └──────────────────────┘ │ clique →     │
│          │ conversas       │ [ digite… ]         (➤)  │ insere texto │
└──────────┴────────────────┴──────────────────────────┴──────────────┘
   w-56/16       360–400px           flex-1                   320px (xl+)
```

Responsivo:
- `< md` (celular): mostra **ou** a lista **ou** o chat (botão voltar no cabeçalho).
- `< lg`: tags do chat descem para uma linha abaixo do cabeçalho.
- `< xl`: painel de respostas rápidas some (toggle no cabeçalho do chat).

## Estrutura

```
src/
├── app/
│   ├── layout.tsx          html + Providers (react-query)
│   ├── login/page.tsx
│   └── (app)/              rotas autenticadas
│       ├── layout.tsx      restaura sessão via /auth/refresh, monta Sidebar, liga o socket
│       ├── conversas/      3 colunas
│       ├── numeros/        cards de números, modais de criar/trocar/QR
│       ├── tags/           CRUD com paleta de cores
│       ├── equipe/         atendentes: criar, ativar/desativar, redefinir senha
│       ├── plano/          medidores de uso, excedente, explicação do limite
│       ├── configuracoes/  aparência + pastas e respostas rápidas (CRUD)
│       ├── admin/          Financeiro do dono (KPIs, série, assinaturas, faturas, margem)
│       ├── clientes/       Clientes do dono: criar, plano/status, ativar, Entrar como
│       └── relatorios/     abre com visão pronta (KPIs + 4 gráficos do período); 'Relatório personalizado' expande o construtor (métrica, agrupamento, filtros, tabela, CSV, salvos)
├── components/
│   ├── layout/Sidebar.tsx | UsageBanner.tsx | ImpersonationBanner.tsx (faixa 'Você está vendo X como dono')
│   ├── chat/ConversationList | ChatPane | TagPicker | QuickRepliesPanel
│   ├── numbers/ProviderForm | NumberDialogs | QrModal
│   └── ui/Modal | Toast | Confirm | Page   primitivos: modal, toasts, confirmação, cabeçalho/shell de página
└── lib/
    ├── api.ts      fetch com Bearer, refresh automático em 401, cookie de refresh
    ├── hooks.ts    todos os useQuery/useMutation + useRealtime (socket → cache)
    ├── store.ts    zustand: sidebar, painel direito, número/status/tags/conversa selecionados
    └── utils.ts    cn()
```

## Estado

- **Servidor** (conversas, mensagens, tags…): react-query. Chaves: `['conversations', filtros]`, `['messages', id]`, `['numbers']`, `['tags']`, `['quick-replies']`, `['usage']`, `['number-qr', id]`.
- **UI** (colunas, filtros, seleção): zustand com `persist` — sidebar recolhida, painel direito e número selecionado sobrevivem ao reload.
- **Token**: em memória (`lib/api.ts`), nunca em localStorage. O refresh está no cookie httpOnly; ao abrir o app, `(app)/layout.tsx` chama `/auth/refresh` para obter um access token novo.

## Tempo real

`useRealtime()` (em `hooks.ts`) abre o socket com `auth: { token }` e:
- `message` → insere/atualiza no cache `['messages', conversationId]`.
- `conversation` → invalida `['conversations']`.
- `number` → guarda `qrCode` em `['number-qr', id]` e invalida `['numbers']`.

## Feedback de carregamento

Regra: **nenhuma ação fica sem resposta visual**.

| Situação | O que o usuário vê | Onde |
|---|---|---|
| Clicou num item do menu | Item muda para ativo na hora e pulsa; barra verde fina no topo avança até a rota trocar | `Sidebar` + `layout/NavigationProgress.tsx` (zustand `useNav`) |
| Rota ainda compilando/carregando | Esqueleto genérico de página | `app/(app)/loading.tsx` |
| Dados da tela carregando | Esqueleto específico (linhas, cards, conversas, bolhas) | `components/ui/Skeleton.tsx`, usado com `query.isLoading` |
| Lista refazendo fetch em segundo plano | Linha fina pulsando acima da lista | `ConversationList` (`isFetching`) |
| Troca de tela concluída | Conteúdo entra com fade de 180 ms | `.animate-fade-in` em `globals.css`, `key={pathname}` no layout |
| Restaurando sessão ao abrir o app | Spinner "Entrando…" | `app/(app)/layout.tsx` |
| Qualquer botão que chama a API | `Button` com `loading={mutation.isPending}`: spinner, desabilitado, texto opcional ("Gerando QR…") | `components/ui/Button.tsx` — **obrigatório** em ação nova |
| Confirmação destrutiva | `ConfirmDialog` aceita `onConfirm` async: spinner no botão, só fecha se der certo | `components/ui/Confirm.tsx` |
| Conectar (QR) | Modal abre imediatamente com placeholder "Gerando QR code…"; QR entra quando a API responde | `numeros/page.tsx` + `QrModal` |

**Densidade**: menu 208px (52px recolhido), lista de conversas 320–350px, painel de respostas 288px; linhas de conversa `py-2`, cabeçalhos 48px, texto base 13px nas áreas densas. Páginas administrativas com `p-4 md:p-6`.

Em **dev** o Next compila cada rota no primeiro acesso, por isso a primeira troca de tela demora alguns segundos; em produção (`pnpm build && pnpm start`) é quase instantâneo e os links são pré-carregados.

## Tema e cores

Dois temas, escolhidos no rodapé do menu (claro / escuro / sistema), aplicados pela classe `dark` no `<html>` antes do primeiro paint (script inline em `app/layout.tsx`, preferência em `localStorage` via `lib/theme.ts`).

| | Claro — "Semáforo" | Escuro — "Sala de controle" |
|---|---|---|
| Ideia | Menu azul-ardósia, área clara, status como faixa cheia | Painel escuro, cores de estado luminosas, grade fina no chat |
| Ação (`accent`) | azul `#2f5bea` | azul `#3b9eff` |
| Aguardando / Atendendo / Encerrado | laranja / azul / cinza | âmbar / turquesa / cinza |
| Balão de saída | azul sólido, texto branco | azul-marinho |

**Tokens** vivem em `app/globals.css` (`:root` = claro, `.dark` = escuro) e são expostos como cores do Tailwind em `tailwind.config.ts`. Regra: **componente nunca usa hex nem `gray-*`/`red-*`** — usa os tokens:

| Uso | Classes |
|---|---|
| Superfícies | `bg-canvas` (fundo da página), `bg-panel` (cartões/listas), `bg-field` (inputs/chips), `border-line` |
| Texto | `text-ink` (principal), `text-muted` (secundário), `text-faint` (terciário) |
| Ação | `bg-accent`, `hover:bg-accent-hover`, `bg-accent-soft`, `text-accent-ink` |
| Menu | `bg-side`, `text-side-ink`, `bg-side-on` |
| Status da conversa | `wait` / `prog` / `done` (+ `-soft`) — ver `STATUS_META` em `ConversationList.tsx` |
| Semânticas | `ok`, `warn`, `danger` (+ `-soft`, `-ink`) |
| Provider | `meta-soft`/`meta-ink` (oficial), `evo-soft`/`evo-ink` (QR) |
| Chat | `bg-chat-in`/`bg-chat-out` e `text-chat-*-ink`; fundo `.chat-bg` |

Cores de **tag** são escolhidas pelo usuário (hex no banco) e aplicadas com `color-mix` para o fundo suave — funcionam nos dois temas. Avatar: cor estável por telefone (`lib/avatar.ts`).

**Tipografia**: Sora (marca, títulos — `font-display`), Source Sans 3 (interface — padrão), IBM Plex Mono (horários, contadores, telefones — `font-mono` + `.tnum`). Carregadas por `next/font`.

## Sinalização de estado (o que o olho lê primeiro)

- Filtros com **contador** por status (`GET /conversations/counts`), atualizado por socket.
- Cada conversa tem **faixa lateral** com a cor do status; conversa selecionada em `accent-soft`.
- Badge de **não-lidas** em `accent`; nome em negrito quando há não-lidas.
- Seletor de número mostra **ponto de conexão** (verde/âmbar) e **badge do provider** (Oficial/QR).
- Cabeçalho do chat: **pill de status** com a mesma cor da faixa.
- Menu: item *Conversas* com badge laranja = quantas aguardando.

Em **/respostas** as pastas também abrem e fecham, mas o que fica guardado são as **fechadas**, não as abertas — o inverso do painel do chat, e de propósito: no chat o atendente procura duas respostas entre muitas, na página de gestão a pessoa veio ver o catálogo. Assim a página nasce mostrando tudo.

## Seleção em massa (lista de conversas)

Botão **Selecionar** acima da lista liga o modo: cada linha ganha caixa de marcação, clicar marca em vez de abrir, e a barra traz *Todos (n)*, a contagem e **Encerrar**.

Duas decisões que não são estéticas:
- **Trocar de filtro limpa a seleção** (`useEffect` em status/número/origem/atendente). Encerrar em massa o que saiu da tela é fechar no escuro, e não há como desfazer trinta de uma vez.
- **Só vale o que está visível** (`marcadosVisiveis`): o que foi marcado e sumiu do filtro não entra no pedido.

O modal em massa não pede valor de venda nem dispara fluxo — ver `BulkCloseModal`, o porquê está no cabeçalho do arquivo. A resposta traz `ignored`, e o toast diz o número: alguém da equipe pode ter encerrado no meio do caminho.

## Marca

A logo fica em `apps/web/public/marca/`, em três recortes: `vogo.png` (original, fundo claro), `vogo-escuro.png` (texto em branco, para o menu lateral, que é escuro nos dois temas) e `vogo-icone.png` (só o robô, para o menu recolhido). A versão escura é gerada do original clareando os pixels **sem cor** — o vermelho da marca fica intacto e o "CHAT", que é preto, sumiria no fundo do menu.

Login, telas de convite/recuperação, título da aba e aviso de versão ainda dizem "Atendo".

## Recolher os dois painéis

O menu da esquerda e o painel da direita recolhem pelo **próprio topo**, cada um com o botão na sua borda interna — quem quer mais espaço para a conversa fecha de onde está olhando.

Fechado, o painel da direita deixa uma **faixa de 36px com o botão de abrir**, do mesmo jeito que o menu recolhido mantém o dele. Sem essa faixa havia um beco: o outro botão de reabrir vive no cabeçalho do chat, que só existe com uma conversa aberta, então fechar o painel na tela de "selecione uma conversa" deixava a pessoa sem nenhuma forma de trazê-lo de volta. O botão do cabeçalho continua, porque é o caminho natural de quem está lendo uma conversa.

O estado fica guardado (`atendo-ui`), junto com o do menu da esquerda.

## Painel direito: dados da conversa

Abaixo das abas Mensagens/Fluxos, um bloco com nome, primeiro nome, telefone, e-mail, endereço e atendente. Clicar insere o valor no campo de mensagem **já resolvido** (vai "Tiago", não `{{contact.name}}`); o ícone ao lado copia. Campo sem valor não aparece.

Serve para o que acontece o tempo todo no atendimento: precisar do e-mail ou do telefone no meio da frase e ter que abrir a ficha, ler, lembrar e voltar — ou digitar de cabeça e errar. O bloco fecha, porque divide espaço com a lista de respostas.

## Conversa longa (carregar o passado)

`useMessages` é `useInfiniteQuery`: abre no fim e busca páginas de 50 para trás quando a pessoa chega perto do topo. Nada é apagado no banco — o que não dá é baixar dois anos de conversa antes de mostrar a primeira mensagem.

Três comportamentos de rolagem, e tratá-los como um só é o que faz o chat pular sozinho:
- **carregou o passado**: a altura é medida *antes* do pedido e recomposta depois, em `useLayoutEffect`, para a pessoa continuar exatamente onde estava;
- **abriu a conversa / chegou mensagem com a pessoa no fim**: vai para o fim;
- **a pessoa está lendo o passado**: não é arrastada para baixo porque o contato respondeu.

Há ainda um `ResizeObserver`, para o caso de a bolha crescer depois (imagem que carrega, player de áudio que monta). Ele não substitui o efeito acima: **não dispara quando o elemento só é criado**, apenas quando muda de tamanho — foi o que fez a conversa abrir parada no topo na primeira tentativa.

## Fila por tempo de espera

Cada conversa aberta mostra **há quanto tempo está sem resposta** (`awaitingSince`), com a cor subindo junto com o atraso (até 15min neutro, 15–60min âmbar, acima de 1h vermelho). Conversa já respondida ou encerrada não mostra nada: selo em tudo vira ruído e ninguém repara nos vermelhos.

O chip **Esperando há mais tempo** reordena a lista (`sort=waiting`), e a escolha fica guardada. Um `setInterval` só, no componente da lista, mantém os selos atualizados — um por linha seriam cinquenta relógios, e sem nenhum o "5min" continuaria dizendo 5min duas horas depois.

O rótulo do número saiu da faixa de tags e foi para a linha da hora: embaixo, ele acrescentava uma faixa inteira só por estar vendo "todos os números", e a lista ficava com o dobro da altura. Agora a linha mede o mesmo nos dois casos (medido: 58px).

## Histórico do atendimento

Botão **Histórico** no cabeçalho do chat abre a linha do tempo (`GET /conversations/:id/events`): quem assumiu, transferiu, devolveu, encerrou e reabriu, com data. No topo, **atendimentos encerrados** e **reaberturas** — é a pergunta que se faz numa auditoria, e é o que distingue um atendimento reaberto de dois atendimentos.

Ator vazio aparece como **Automação**, nunca em branco: em auditoria, campo vazio é lido como falha de registro.

## Relatórios (gráficos)

`components/reports/ReportChart.tsx` (Recharts 3). Regras:
- Agrupamento por tempo → linha (dias sem dado preenchidos com 0 em `fillTime`); por categoria → barras (horizontais quando há > 4 itens ou rótulos longos); pizza junta o excedente de 6 fatias em "Outros".
- Uma escala só; grade discreta (`--grid`); tooltip por marca; tabela alternativa (ícone de tabela) e CSV.
- Cores categóricas `--c1…--c6` em **ordem fixa**, validadas para daltonismo e contraste nos dois temas (script `validate_palette` do skill dataviz). Nunca gerar cor extra: além de 6, agrupar.
- `XAxis`/`YAxis` precisam ser filhos **diretos** do chart — Fragment quebra a detecção do Recharts.

## Padrões

- Componentes de página são `'use client'` (dependem de estado e socket).
- Texto de UI em português; nomes de código em inglês.
- Cores em `tailwind.config.ts`: `brand` (verde), `surface` (fundos/bordas). Fundo do chat: classe `.chat-bg` em `globals.css`.
- Erros de mutação: `toast.err(err)`; sucesso: `toast.ok('…')` (`components/ui/Toast.tsx`). Confirmações destrutivas usam `ConfirmDialog`, nunca `window.confirm`.
- `useMe()` dá role/nome do usuário logado; telas escondem ações de admin quando `role === 'agent'` (o back também bloqueia — a UI é só conveniência).
- Respostas rápidas comunicam com o composer por um `CustomEvent('atendo:insert-text')` — evita acoplar os dois painéis.
- O `ChatPane` carrega a conversa por id (`useConversation`), não a procura na lista — assim ela não some quando muda de status. Ao responder uma conversa em *Aguardando*, o filtro muda sozinho para *Em atendimento* mantendo a seleção (`setStatus(s, keep)`).
- Posse: em *Aguardando* o cabeçalho tem **Assumir**; em *Em atendimento* (dono ou admin) tem **Transferir** (menu com atendentes + *Devolver à fila*). Se outra atendente é dona, o composer vira um aviso. A aba *Em atendimento* chama-se **Minhas** para atendente comum; admin tem um seletor "Todos / Só as minhas / <atendente>".
- Cadeado (gerente/admin em conversa alheia): botão de cadeado no lugar do composer; aberto → campo âmbar de nota interna (`POST …/notes`); bolha de nota centralizada com borda âmbar. Reseta ao trocar de conversa.
- Número desconectado: o composer é substituído por um aviso com link para *Números* (o back também recusa o envio). Mensagens com `status: failed` têm botão **reenviar** (`POST …/resend`).
- Mídia: `MediaBody` renderiza imagem/áudio/vídeo/documento a partir de `mediaUrl` (assinada, expira em 1 h — ao expirar, refetch das mensagens renova). Anexo no composer: `uploadFile()` → prévia → envio com `mediaKey`.


## Mídia no chat

Acima do campo de texto há atalhos diretos: **Foto**, **Vídeo**, **Arquivo** e **Áudio**.
Cada um abre o seletor já filtrado pelos tipos que a API aceita, para o atendente não
escolher um arquivo que seria recusado depois. O clipe continua ao lado do campo, para
quem prefere escolher qualquer tipo de uma vez.

Antes tudo isso existia apenas atrás do clipe, e na prática ninguém encontrava.

**Áudio gravado no navegador** (`AudioRecorder`): pede o microfone, mostra o tempo enquanto
grava, e ao parar vira anexo — daí em diante é igual a um arquivo escolhido. Botão para
descartar sem enviar, teto de 5 minutos e descarte automático de clique acidental (menos de
1 segundo). O formato é o melhor que o navegador oferecer (ogg/opus, senão webm/opus ou
mp4); a conversão final para o padrão do WhatsApp fica com o provider.

O upload normaliza o tipo: o navegador envia `audio/webm;codecs=opus` ao gravar, e sem tirar
o parâmetro a extensão do arquivo salvo saía errada.

**Tipos aceitos** (`ALLOWED` em `media.controller.ts`): JPEG, PNG, WebP e GIF; MP4 e 3GPP;
OGG, MP3, MP4, AAC e WebM de áudio; PDF, Word e Excel. **HEIC do iPhone não entra** — a
recusa é explícita ("Tipo não permitido: image/heic"), mas o ideal seria converter.


## Respostas rápidas com anexo

Cada resposta pode ter **um arquivo** (áudio gravado, foto, vídeo ou documento) além do
texto. Com anexo, o texto vira a **legenda** — e por isso deixa de ser obrigatório.

Ao clicar na resposta no painel, o arquivo e a legenda entram no campo de digitação como um
anexo comum: o atendente ainda revisa e clica em enviar. As variáveis `{{contact.name}}` e
`{{agent.name}}` continuam sendo substituídas.

O anexo é enviado uma vez no cadastro (Configurações → Respostas rápidas) e reaproveitado
em todos os envios — não sobe de novo a cada uso. A chave do storage nunca sai crua: a API
devolve uma URL assinada e temporária, e recusa `mediaKey` de outro cliente.


## Prévia antes de enviar mídia

Escolher um arquivo **não envia nada**. Abre uma tela sobre o chat com o que foi escolhido, a
legenda e, em imagem, as ferramentas de marcação. Antes, o arquivo subia no momento da
escolha e a pessoa só percebia que pegou o errado depois de mandar — e aí já era mensagem
gasta, cobrada e vista pelo contato.

| Tipo | O que a prévia mostra |
|---|---|
| Imagem | a imagem, com rabisco (6 cores, 3 espessuras, desfazer/refazer/apagar) |
| Vídeo | o vídeo com controles |
| Áudio | o áudio com controles — inclusive o que acabou de ser gravado |
| Documento | nome e aviso de que o contato recebe para baixar |

O áudio gravado passa pela mesma prévia: dá para ouvir antes de mandar, em vez de descobrir
depois que ficou ruim.

**O desenho é achatado na imagem no momento de enviar**, na resolução original do arquivo — o
WhatsApp recebe uma imagem só, não imagem mais camada. Os traços são guardados em coordenadas
de 0 a 1, então não escorregam quando a janela muda de tamanho e a espessura acompanha a
escala: traço fino na tela não sai grosso no arquivo. O resultado sai em PNG, porque JPEG
borra marcação fina.

Se o envio falhar, **a prévia continua aberta** com o arquivo e a legenda: o trabalho de
marcar a imagem não se perde num erro de rede.


## Ver imagem recebida

Clicar numa imagem do histórico abre um visualizador **sobre o chat**, não uma aba nova:
abrir fora tirava o atendente da conversa, que depois voltava e tinha de achar o lugar de
novo.

Fecha com `Esc` ou clique no fundo — **clicar na imagem não fecha**, senão olhar de perto
fecharia sem querer. As setas (e `←` / `→`) percorrem as outras imagens da mesma conversa,
que é como se vê um comprovante seguido da foto do produto sem ficar fechando e reabrindo.
O botão de baixar continua disponível para quem quer o arquivo.


## Respostas rápidas: módulo próprio

A gestão de pastas e respostas ocupava **115 das 222 linhas** da página de Configurações.
Virou rota própria (`/respostas`), no menu lateral. Quem entra em Configurações quer aparência,
horário ou segurança — não manter um catálogo que a equipe usa o dia inteiro.

Editar exige `quick_replies.manage`; sem a permissão a tela mostra o conteúdo e esconde as
ações (a API checa de novo).

## Preferências de tela

`usePersistedState` (`lib/persisted.ts`) guarda no navegador o que o atendente ajusta e espera
reencontrar: pasta aberta no painel de respostas, aba escolhida (Mensagens/Fluxos), menu
recolhido.

Uma armadilha vale registrar: gravar a cada mudança de valor **apaga o que acabou de ser
lido**. Na montagem, o efeito de escrita roda no mesmo ciclo do de leitura e ainda enxerga o
valor inicial. Por isso o hook só grava depois que o usuário mexeu, marcado no próprio setter
— depender da ordem dos efeitos não resolve.
