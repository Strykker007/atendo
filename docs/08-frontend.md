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
│       ├── configuracoes/  aparência, horários de atendimento (quadros/faixas/simular), boas-vindas, fluxos padrão, segurança
│       ├── admin/          Financeiro do dono (KPIs, série, assinaturas, faturas, margem)
│       ├── clientes/       Clientes do dono: criar, plano/status, ativar, Entrar como
│       └── relatorios/     abre com visão pronta (KPIs + 4 gráficos do período); 'Relatório personalizado' expande o construtor (métrica, agrupamento, filtros, tabela, CSV, salvos)
├── components/
│   ├── layout/Sidebar.tsx | CompanySwitcher.tsx (empresa ativa, ver empresas.md) | UsageBanner.tsx | ImpersonationBanner.tsx (faixa 'Você está vendo X como dono')
│   ├── chat/ConversationList (botão 👥 agrupa a fila por atendente) | ChatPane | TagPicker | QuickRepliesPanel
│   ├── numbers/ProviderForm | NumberDialogs | QrModal
│   └── ui/Modal | Toast | Confirm | Page   primitivos: modal, toasts, confirmação, cabeçalho/shell de página
└── lib/
    ├── api.ts      fetch com Bearer, header x-company-id (empresa ativa), refresh automático em 401, cookie de refresh
    ├── hooks.ts    todos os useQuery/useMutation + useRealtime (socket → cache)
    ├── store.ts    zustand: sidebar, painel direito, empresa/número/status/tags/conversa selecionados, agrupar por atendente
    └── utils.ts    cn()
```

## Estado

- **Servidor** (conversas, mensagens, tags…): react-query. Chaves: `['conversations', filtros]`, `['messages', id]`, `['numbers']`, `['tags']`, `['quick-replies']`, `['usage']`, `['number-qr', id]`.
- **UI** (colunas, filtros, seleção): zustand com `persist` — sidebar recolhida, painel direito e número selecionado sobrevivem ao reload.
- **Token**: em memória (`lib/api.ts`), nunca em localStorage. O refresh está no cookie httpOnly; ao abrir o app, `(app)/layout.tsx` chama `/auth/refresh` para obter um access token novo.

## Tempo real

`useRealtime()` (em `hooks.ts`) abre o socket com `auth: { token }` e:
- `message` → insere/atualiza no cache `['messages', conversationId]`. Também é por aqui que chega a mudança de status (webhook de entrega/leitura): a mensagem vem inteira e o `StatusIcon` da bolha troca sozinho — 🕒 enviando, ✓ enviada, ✓✓ entregue, ✓✓ ciano (`--tick-read`) lida, ⚠ falha (tooltip com o erro).
- `conversation` → invalida `['conversations']`, a conversa e `['kanban']`.
- `kanban` → invalida `['kanban']` e `['tags']` (colunas mudaram).
- `messages_cleared` → histórico limpo: invalida `['messages', conversationId]`. Mensagem apagada chega pelo próprio `message` (já com `deletedAt` e sem conteúdo) e vira o aviso "Mensagem apagada por…" na bolha ([Apagar mensagens](apagar-mensagens.md)).
- `typing` → grava `{state, at}` em `['typing', conversationId]` (`paused` limpa). Mensagem recebida (`message` com `direction: 'in'`) também limpa.
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
| Ideia | Menu azul-ardósia, área clara, status como faixa cheia | Painel slate suave, cores de estado luminosas, fundo do chat liso em grafite zinc-900, recebido zinc-800, enviado blue-600 |
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
| Chat | `bg-chat-in`/`bg-chat-out` e `text-chat-*-ink`; fundo `.chat-bg`. Claro: fundo zinc-100, recebido branco com contorno `--bub-in-line` (zinc-200/60), enviado blue-600. Escuro: fundo zinc-900, recebido zinc-800, enviado blue-600 |

**Transparência em token** (`bg-muted/30`, `ring-accent/40`…) funciona porque `tailwind.config.ts` expõe cada token como `color-mix(in srgb, var(--x) calc(<alpha-value> * 100%), transparent)`. Antes era só `var(--x)`, e o Tailwind 3 não sabe aplicar `/NN` nisso: a classe não era gerada e ~60 usos no app não faziam nada (inclusive a onda do áudio recebido, que sumia). Se mudar o helper `v()`, mantenha o `<alpha-value>`.

Cores de **tag** são escolhidas pelo usuário (hex no banco) e aplicadas com `color-mix` para o fundo suave — funcionam nos dois temas. Avatar: cor estável por telefone (`lib/avatar.ts`). Foto ampliada: no cabeçalho do chat e na ficha do contato o avatar é clicável (`ZoomableAvatar`, dica "Clique para ampliar") e abre o `AvatarViewer` (`components/chat/AvatarViewer.tsx`) — foto grande ou, sem foto/URL expirada, a inicial grande com "Sem foto de perfil"; nome e telefone formatado embaixo; fecha com Esc (só ele, mesmo aberto dentro da ficha), clique fora ou X. Portal com `z-[60]`, animação em CSS (`.avatar-in/.avatar-out`, respeita `prefers-reduced-motion`). Na lista de conversas não: a linha inteira já é um botão.

**Tipografia**: Sora (marca, títulos — `font-display`), Source Sans 3 (interface — padrão), IBM Plex Mono (horários, contadores, telefones — `font-mono` + `.tnum`). Carregadas por `next/font`.

## Sinalização de estado (o que o olho lê primeiro)

- Filtros com **contador** por status (`GET /conversations/counts`), atualizado por socket.
- Cada conversa tem **faixa lateral** com a cor do status; conversa selecionada em `accent-soft`.
- Badge de **não-lidas** em `accent`; nome em negrito quando há não-lidas.
- Seletor de número mostra **ponto de conexão** (verde/âmbar) e **badge do provider** (Oficial/QR).
- Cabeçalho do chat: **pill de status** com a mesma cor da faixa.
- Menu: item *Conversas* com badge laranja = quantas aguardando.

Em **/respostas** e em **/fluxos** há seleção múltipla (checkbox por item, por pasta nas respostas, e "selecionar todos") com **Duplicar** e **Exportar selecionados** — um arquivo só —, além de duplicar/exportar um item pelos ícones da linha e **Importar** no cabeçalho (aceita o arquivo individual ou o lote). Os dois módulos usam o mesmo formato e comportamento; ver [10](10-fluxos-de-automacao.md#replicar-um-fluxo) e [07](07-api.md).

Em **/respostas** as pastas também abrem e fecham, mas o que fica guardado são as **fechadas**, não as abertas — o inverso do painel do chat, e de propósito: no chat o atendente procura duas respostas entre muitas, na página de gestão a pessoa veio ver o catálogo. Assim a página nasce mostrando tudo.

## Seleção em massa (lista de conversas)

Botão **Selecionar** acima da lista liga o modo: cada linha ganha caixa de marcação, clicar marca em vez de abrir, e a barra traz *Todos (n)*, a contagem e **Encerrar**.

Duas decisões que não são estéticas:
- **Trocar de filtro limpa a seleção** (`useEffect` em status/número/origem/atendente). Encerrar em massa o que saiu da tela é fechar no escuro, e não há como desfazer trinta de uma vez.
- **Só vale o que está visível** (`marcadosVisiveis`): o que foi marcado e sumiu do filtro não entra no pedido.

No encerramento individual (`CloseModal`), **Comprou** abre em **lista de itens** (descrição flexível + valor de largura fixa por linha — o modal alarga para `max-w-2xl` nesse modo, "+ Adicionar item", total somado na hora) e vai como `items`; o link "Mudar para campo de texto livre" volta ao formato antigo (descrição em bloco + total digitado).

Campos em R$ usam `components/ui/MoneyInput` (máscara de caixa: dígitos entram pela direita, exibe "1.500,00", trabalha com `number`). Está no encerramento (itens e valor livre) e no formulário de plano (mensalidade/anuidade, custo, excedentes, teto de IA; R$ por mensagem e por interação de IA com 3 casas).

O modal em massa não pede valor de venda nem dispara fluxo — ver `BulkCloseModal`, o porquê está no cabeçalho do arquivo. A resposta traz `ignored`, e o toast diz o número: alguém da equipe pode ter encerrado no meio do caminho.

## Marca

A logo fica em `apps/web/public/marca/`, em três recortes: `vogo.png` (original, fundo claro), `vogo-escuro.png` (texto em branco, para o menu lateral, que é escuro nos dois temas) e `vogo-icone.png` (só o robô, para o menu recolhido). A versão escura é gerada do original clareando os pixels **sem cor** — o vermelho da marca fica intacto e o "CHAT", que é preto, sumiria no fundo do menu.

Login e telas de convite/recuperação usam a logo horizontal (`MarcaHorizontal`, `components/ui/Marca.tsx`): `vogo-horizontal.png` no tema claro e `vogo-horizontal-escuro.png` no escuro (gerada da clara clareando os pixels sem cor; bordas transparentes cortadas). O título da aba é "VOGO.CHAT". O aviso de versão e as telas do dono (Financeiro, Clientes) ainda dizem "Atendo".

## Cabeçalho do chat

`flex-wrap`: a largura disponível ali não depende do tamanho da tela e sim de o painel da direita estar aberto. Com ele aberto, as ações estouravam e o **Encerrar ficava escondido atrás da borda do painel** (medido: conteúdo de 608px numa caixa de 594px). Esconder botão por breakpoint não resolveria — o breakpoint não sabe do painel.

O botão de recolher o painel saiu daqui: ele já existe no topo do próprio painel, e ter os dois era duplicata.

## Não lidas e tempo real

A rota `POST /conversations/:id/read` existia desde o começo e **ninguém a chamava**: o balão de não lidas aparecia e nunca mais saía. Agora abrir a conversa marca como lida (otimista no cache, para não piscar).

O socket do tempo real era criado num `useEffect` que desistia quando ainda não havia token — e o token chega depois, de uma chamada de refresh. Quando a corrida dava errado, o socket **nunca** era criado e o painel só recebia mensagem nova depois de um F5. `setAccessToken` agora avisa quem estiver esperando (`onAccessToken`), e o efeito refaz a conexão quando o token aparece.

## Recolher os dois painéis

O menu da esquerda e o painel da direita recolhem pelo **próprio topo**, cada um com o botão na sua borda interna — quem quer mais espaço para a conversa fecha de onde está olhando.

Fechado, o painel da direita deixa uma **faixa de 36px com o botão de abrir**, do mesmo jeito que o menu recolhido mantém o dele. Sem essa faixa havia um beco: o outro botão de reabrir vive no cabeçalho do chat, que só existe com uma conversa aberta, então fechar o painel na tela de "selecione uma conversa" deixava a pessoa sem nenhuma forma de trazê-lo de volta. O botão do cabeçalho continua, porque é o caminho natural de quem está lendo uma conversa.

O estado fica guardado (`atendo-ui`), junto com o do menu da esquerda.

## Painel direito: dados da conversa

Abaixo das abas Mensagens/Fluxos, um bloco com nome, primeiro nome, telefone, e-mail, endereço, **os campos livres da ficha do contato** (data como dd/mm/aaaa) e atendente. Clicar insere o valor no campo de mensagem **já resolvido** (vai "Tiago", não `{{contact.name}}`); o ícone ao lado copia. Campo sem valor não aparece.

Serve para o que acontece o tempo todo no atendimento: precisar do e-mail ou do telefone no meio da frase e ter que abrir a ficha, ler, lembrar e voltar — ou digitar de cabeça e errar. O bloco fecha, porque divide espaço com a lista de respostas.

## Conversa longa (carregar o passado)

`useMessages` é `useInfiniteQuery`: abre no fim e busca páginas de 50 para trás quando a pessoa chega perto do topo. Nada é apagado no banco — o que não dá é baixar dois anos de conversa antes de mostrar a primeira mensagem.

Três comportamentos de rolagem, e tratá-los como um só é o que faz o chat pular sozinho:
- **carregou o passado**: a altura é medida *antes* do pedido e recomposta depois, em `useLayoutEffect`, para a pessoa continuar exatamente onde estava;
- **abriu/trocou de conversa**: vai para o fim na hora, sempre — a posição da conversa anterior é esquecida. Esse recomeço fica no próprio `useLayoutEffect`: num `useEffect` ele rodava *depois* da rolagem e a conversa nova abria parada no meio;
- **chegou mensagem com a pessoa no fim**: rola suave até ela;
- **a pessoa está lendo o passado**: não é arrastada para baixo porque o contato respondeu.

"Está no fim" (`noFim`) só é desligado quando a rolagem **sobe**. A rolagem automática sempre desce, e uma imagem que carrega entre o `scrollTop = scrollHeight` e o evento de scroll aumentava a distância até o fim e desligava o acompanhamento — o chat parava no meio, sobretudo no mini-chat do Kanban (imagens já em cache). Kanban e tela de conversas usam o mesmo `ChatPane`, então valem as mesmas regras.

Há ainda um `ResizeObserver`, para o caso de a bolha crescer depois (imagem que carrega, player de áudio que monta). Ele não substitui o efeito acima: **não dispara quando o elemento só é criado**, apenas quando muda de tamanho — foi o que fez a conversa abrir parada no topo na primeira tentativa.

**Ordem da timeline**: pelo horário da mensagem no WhatsApp (`createdAt`), não pela ordem de chegada. O socket insere cada mensagem nova no topo da página 0 e, quando o número reconecta, a Evolution entrega o atraso fora de ordem — por isso `mensagensEmOrdem` reordena (sort estável: empate no mesmo segundo fica na ordem de chegada). A API pagina por `createdAt desc, queueSeq desc` pelo mesmo motivo.

## Filtros da lista

Os três botões de status seguem a ordem de mercado: **Atendendo | Aguardando | Encerrado** (o que já é meu, depois a fila, depois o histórico). A tela **abre sempre em Aguardando** — a aba escolhida não é lembrada entre visitas (`status` fora do `partialize` do `useUI`). Busca e os três botões de status ficam sempre à vista; **tag, origem, ordem e atendente entram atrás do ícone de filtro**, porque são ajuste ocasional e ocupavam quatro faixas fixas no alto — espaço que a fila precisa mais (a lista começava 70px mais abaixo).

O ícone mostra **um contador quando há filtro ligado**, e aparece "Limpar filtros". Sem esse aviso, esconder filtro vira armadilha: a lista some e ninguém lembra por quê.

## Fila por tempo de espera

Cada conversa aberta mostra **há quanto tempo está sem resposta** (`awaitingSince`), com a cor subindo junto com o atraso (até 15min neutro, 15–60min âmbar, acima de 1h vermelho). Conversa já respondida ou encerrada não mostra nada: selo em tudo vira ruído e ninguém repara nos vermelhos.

O chip **Esperando há mais tempo** reordena a lista (`sort=waiting`), e a escolha fica guardada. Um `setInterval` só, no componente da lista, mantém os selos atualizados — um por linha seriam cinquenta relógios, e sem nenhum o "5min" continuaria dizendo 5min duas horas depois.

O rótulo do número saiu da faixa de tags e foi para a linha da hora: embaixo, ele acrescentava uma faixa inteira só por estar vendo "todos os números", e a lista ficava com o dobro da altura. Agora a linha mede o mesmo nos dois casos (medido: 58px).

Esse rótulo é o `ChannelBadge` (`components/chat/ChannelBadge.tsx`, antigo `NumberBadge`): pílula com fundo suave na **cor do número**, ícone do WhatsApp e nome em negrito. O texto é a cor misturada com `--ink` (`color-mix`) para continuar legível em cor clara e no tema escuro. Cor ausente ou fora de `#RRGGBB` cai no verde `#25D366`; cor dinâmica vai sempre por `style` (Tailwind não gera classe em runtime). Número desconectado ganha um ponto vermelho. `formatPhone` tira sufixo de JID (`@s.whatsapp.net`) e formata BR como `+55 DD XXXXX-XXXX`.

O canal aparece na **lista**: selo sempre visível (mesmo filtrando um número) + faixa de 4px na cor do canal na **borda direita** da linha — a esquerda já é do semáforo de status. Dentro do chat não há selo de canal (o do cabeçalho sobrepunha o nome e a faixa "Enviando via" acima do campo foi retirada a pedido). Número desconectado troca o composer por um alerta vermelho e bloqueia o envio.

O envio manda `expectedNumberId` (o canal mostrado). Se a conversa mudou de número, a API responde 409 `number_changed` sem enviar: o `useSendMessage` recarrega a conversa e a tela mostra o toast com o canal novo, com o texto devolvido ao campo. `api()` lança `ApiError` (`status` + `code`) para a tela reagir pelo código, não pelo texto.

A cor é escolhida no card do número em *Números* (paleta das tags).

## Aparência do chat

O fundo era cinza chapado — e chapado é o que faz a tela parecer sem vida: os balões flutuam num vazio e a conversa não ganha lugar. Agora tem um ponto discreto a cada 18px (de perto quase não se vê, de longe o olho sente), o balão enviado tem degradê curto e sombra de contato, e os cantos ficaram mais arredondados.

**Separador de dia** entre as mensagens: "Hoje", "Ontem", o dia da semana dentro dos últimos sete dias e a data depois disso. Sem ele a conversa é um rolo contínuo — o atendente lê "às 14:20" e não sabe se foi hoje ou há três semanas, e essa diferença muda o que ele responde.

## Responder mensagem (citação)

O botão aparece no hover, **fora** da bolha, para não roubar espaço do texto, e só em mensagem com `externalId` (pendente/falha/nota interna não têm o que citar). Escolhida a mensagem, uma faixa acima do campo mostra "Respondendo a você" / "Respondendo a <nome do contato>" e o resumo, com **X** para cancelar; enviar (texto ou anexo) manda o `quotedExternalId` e limpa a faixa. Trocar de conversa também limpa.

Dentro da bolha, a caixa de citação (`Citacao` em `ChatPane.tsx`) usa primeiro o `message.quoted` que a API já resolve (`preview` e `authorName`; autor nulo vira "Você" na enviada e o nome do contato — ou `+telefone` — na recebida). Sem ele, cai nas origens antigas, nesta ordem: a mensagem que temos no histórico, o texto que o provider mandou junto (`quotedPreview`) e um rótulo genérico.

O resumo vem de `messagePreview` (shared): texto puro, ou o ícone do tipo na frente da legenda (`📷 Promoção`), ou só o rótulo da mídia (`📷 Foto`, `🎤 Áudio`, `📄 nome.pdf`) — o mesmo resumo da lista de conversas.

Com `quoted.messageId` a caixa é clicável: rola até a bolha citada (`id="msg-<id>"`) e a destaca por um instante. Se ela ainda não foi carregada (paginação), um aviso pede para rolar para cima.

**Resposta a status (os "stories")** é o motivo de a segunda origem existir: o status não é mensagem da conversa e some em 24h. O conteúdo citado é guardado no momento em que a resposta chega, então meses depois a conversa ainda mostra o selo **"Respondido do seu Stories"** e *"📷 Foto: Promoção 20%"* em cima do "quero esse". Quando o status era foto/vídeo, a miniatura aparece ao lado (`quoted.mediaUrl`) e o bloco inteiro abre no `MediaViewerModal` — a mídia do status entra na lista de mídias da conversa logo antes da mensagem que responde. Enquanto o worker baixa (`quoted.mediaType` preenchido sem `mediaUrl`) e enquanto o navegador carrega a imagem, um spinner ocupa o lugar da miniatura. Só funciona no provider QR; a API oficial da Meta não entrega status.

## Barra do composer

Os atalhos ficam **abaixo** do campo de texto, como no WhatsApp: a mão está no teclado, e atalho acima do texto obriga o olho a subir e voltar. Cada botão abre o seu menu ancorado ali mesmo (`ComposerBar`), que fecha com Esc ou clique fora.

Da esquerda para a direita: **clipe** (foto, vídeo, documento — antes esses três eram botões soltos acima *e* o clipe repetia os mesmos), **raio** = respostas rápidas (ícone do raio em todo o sistema), **fluxo** para disparar, **pausa** ⏸ (menu pausar / continuar de onde parou / cancelar fluxo, âmbar quando pausado — ver [fluxos › Pausar](fluxos.md#pausar-o-robô-na-conversa)), **relógio** ⏰ para agendar a mensagem (modal com data/hora; a faixa retrátil acima do campo lista as agendadas e permite cancelar — ver [Agendamento de mensagens](agendamento-de-mensagens.md)), **emoji**, **@** para mencionar a equipe e **A sublinhado** para assinatura. O copiloto de IA fica na ponta direita.

Os menus da barra (respostas rápidas, fluxos, menção…) têm altura máxima (`min(60vh, 26rem)`) e rolam por dentro — lista longa não sai pelo topo da tela. No menu de respostas a busca fica fixa no topo e **todas** as respostas aparecem (antes cortava em 8). O painel lateral de respostas/fluxos também rola dentro da própria coluna.

O campo de texto (resposta e nota) **cresce com o texto** (`useAutoResize`) até `max-h-40`; daí em diante rola por dentro, sem empurrar os botões.

O **resumo por IA** fica no cabeçalho do chat, como ícone ✨ ao lado de Transferir/Histórico, e abre um popover (antes virava uma faixa dentro da linha do cabeçalho e quebrava o alinhamento). Abrir sempre consulta a API, que devolve o cache se não chegou mensagem nova; o badge mostra há quanto tempo foi gerado e **Atualizar** força uma geração nova (cobra uma interação).

Emoji, menção e resposta rápida entram **no ponto do cursor**, não no fim: emoji no meio da frase é o caso comum. O menu de emoji **não fecha** ao escolher (dá para emendar vários) e não tira o foco do campo; fecha com Esc, clique fora ou no próprio botão.

**Colar imagem** (Ctrl/Cmd+V no campo): imagem no clipboard abre a mesma prévia do anexo (`MediaPreview`), com legenda e confirmação. Texto cola normal.

**Digitando**: `useTyping(conversationId)` lê `['typing', id]`. Enquanto houver estado, o cabeçalho troca a linha do telefone por "Fulano está digitando…"/"está gravando áudio…" e o fim da lista ganha um balão com três pontos em onda (`.typing-dot`). Se nenhum evento novo chegar em 5 s (`TYPING_TIMEOUT_MS`), o indicador some sozinho — o "parou" do WhatsApp às vezes não vem.

**Tipos de mensagem** (`components/chat/messages/`): `structuredBody(m)` decide o corpo da bolha pelo `m.content` — `ButtonsMessage` (texto + botões como prévia; "Copiar" copia o código/Pix para o atendente e `url` abre o link, o resto é só o que o contato vê), `ListMessage` (cabeçalho, texto e "Ver opções" que expande as linhas), `LocationMessage` (card com link para o Google Maps — sem mapa estático, que exigiria chave) e `ContactMessage` (avatar, nome, telefones e copiar número). Tipo sem `content` (linhas antigas) ou `unknown` cai em `UnknownMessageFallback`: mostra o texto se houver, senão "Mensagem interativa recebida"/"Conteúdo não suportado para visualização" — nunca a palavra `unknown`. Sem `content`, a bolha segue o caminho comum (`MediaBody` + texto).

**Encaminhada**: `m.forwarded` põe no topo da bolha a seta + "_Encaminhada_" (`ForwardedLabel`; score ≥ 5 → "Encaminhada com frequência").

**Encaminhar**: botão de seta no hover da bolha (junto de responder/reagir; não aparece para figurinha nem para mensagem sem `externalId`). Abre `ForwardModal`: busca nas conversas ativas (em atendimento + fila, menos a atual), escolhe até 5 e chama `useForwardMessage`. Os destinos que falharem (ex.: conversa de outro atendente, janela da Meta) voltam num toast e ficam selecionados para tentar de novo. No celular do contato chega como mensagem comum — os providers não aceitam a marca de encaminhada.

**Reações**: o emoji com que o contato (ou o cliente, pelo celular) reagiu aparece num selo pendurado na borda da bolha reagida, atualizado pelo evento `message` do socket. Reação não vira bolha. O atendente reage pelo botão de carinha que aparece no hover ao lado da bolha (junto do responder): seis emojis rápidos; escolher o que já está lá retira. Só para mensagem que chegou ao WhatsApp (tem `externalId`, não está pendente/com falha) e com o número conectado.

**Assinatura** liga/desliga e fica guardada por navegador — é preferência de quem atende, não configuração da empresa. Ligada, a mensagem sai com `*Nome:*` na primeira linha (negrito no WhatsApp), que é como o cliente sabe com quem está falando num número de empresa. No painel a bolha mostra só **Nome:** em negrito, sem os asteriscos (`TextoAssinado`; também reconhece o formato antigo `*Nome*`). A assinatura é aplicada num ponto só (`assinar()` no `ChatPane`), usado pelo campo **e** pela resposta rápida com contagem (texto e legenda de mídia) — antes a rápida saía pelo timer sem nome. Na edição de mensagem, a assinatura fica fora do campo e volta igual ([Editar mensagens](editar-mensagens.md)).

**Menção** insere `@Nome` e serve para a nota interna ("@Ana, esse é seu cliente"). Ela **não notifica** ninguém ainda — não existe notificação interna no sistema, e fingir que avisa seria pior que não ter.

## Nova conversa (disparo ativo)

Botão **💬+** ao lado da busca da lista abre `NewConversationModal`: contato (busca nas conversas por nome/telefone, ou digitar um telefone novo + nome opcional), **número de saída** (só conectados; padrão = o do filtro da lista) e a mensagem:

- **API oficial (Meta):** *Template aprovado* (padrão) — seletor com botão de sincronizar (`?refresh=1`), um campo por variável (o `{{1}}` do corpo já vem com `{{contact.first_name}}`), pré-visualização e aviso de cobrança. *Texto livre* fica disponível, mas só é aceito se o contato escreveu nas últimas 24h.
- **Evolution:** texto livre (aceita variáveis).

**Número avulso** (fora da agenda e da base): digite o telefone com DDD (`62999999999`, assume 55) ou já com DDI (`5562999999999`, até 15 dígitos) e escolha *Iniciar com …* ou aperte **Enter**. Número curto/longo demais mostra o aviso embaixo do campo. O contato é criado no envio e a tela abre a conversa.

A busca (`GET /conversations/start/contacts`) traz contatos da base e, numa seção **Agenda do celular**, nomes sincronizados do aparelho que ainda não são contato (escolher um preenche telefone + nome e, se possível, o número de onde veio). Para quem não lembra o nome, **Ver agenda do celular** (só em número Evolution) abre a agenda inteira do número selecionado (`GET /numbers/:id/phonebook`), em ordem alfabética, de 50 em 50 carregando sozinha ao rolar (scroll infinito) e virtualizada — só as linhas visíveis vão para o DOM, então agenda de milhares de nomes não trava; o campo de busca passa a filtrar essa lista. A busca é no servidor ([busca textual](07-api.md#busca-textual-de-contatos): sem acento, palavras em qualquer ordem, telefone com máscara), com debounce de 300 ms (`useDebounced`) e spinner dentro do campo enquanto procura. Quem já é contato vem marcado *já é contato* e abre o contato existente.

**Janela de 24h fechada no chat.** Conversa em número da API oficial cujo contato não escreve há 24h troca o composer por uma barra amarela *"Janela de 24h fechada"* com **Enviar template** (`TemplateSendModal`) e o atalho da nota interna. O relógio é o mesmo da lista (`useMinuto`), então a barra aparece sozinha quando a janela vence com a conversa aberta. O seletor (`TemplateFields` + `useTemplateChoice`) é o mesmo do *Nova conversa* e do template de lembrete da Agenda.

Enviou → a lista vai para *Atendendo* e a conversa abre. Uma `idempotencyKey` por abertura do modal evita envio duplo no clique duplo.

## Uma conversa, vários atendimentos

A lista mostra **uma linha por pessoa**, não uma por atendimento. Encerrar e receber mensagem de novo **reabre a mesma conversa** (volta para *Aguardando*) em vez de criar outra — o contato deixa de aparecer duplicado, em "encerrado" e em "aguardando" ao mesmo tempo, com o histórico partido entre as duas.

Os atendimentos continuam separados, mas por dentro: cada encerramento é um registro no **Histórico** (botão no cabeçalho), e é de lá que o relatório de vendas conta. Contar pela conversa somaria uma venda só quando a mesma pessoa compra em março e volta a comprar em junho.

## Histórico do atendimento

Botão **Histórico** no cabeçalho do chat abre a linha do tempo (`GET /conversations/:id/events`): quem assumiu, transferiu, devolveu, encerrou e reabriu, com data. No topo, **atendimentos encerrados** e **reaberturas** — é a pergunta que se faz numa auditoria, e é o que distingue um atendimento reaberto de dois atendimentos.

Ator vazio aparece como **Automação**, nunca em branco: em auditoria, campo vazio é lido como falha de registro.

## Relatórios (gráficos)

`components/reports/ReportChart.tsx` (Recharts 3). Regras:
- Agrupamento por tempo → linha (dias sem dado preenchidos com 0 em `fillTime`); por categoria → barras (horizontais quando há > 4 itens ou rótulos longos); pizza junta o excedente de 6 fatias em "Outros".
- Uma escala só; grade discreta (`--grid`); tooltip por marca; tabela alternativa (ícone de tabela) e CSV.
- Cores categóricas `--c1…--c6` em **ordem fixa**, validadas para daltonismo e contraste nos dois temas (script `validate_palette` do skill dataviz). Nunca gerar cor extra: além de 6, agrupar.
- `XAxis`/`YAxis` precisam ser filhos **diretos** do chart — Fragment quebra a detecção do Recharts.
- Métrica `revenue` formata em R$ (tooltip `fmtBRL`, eixo compacto "12 mil"); `win_rate` em %. A seção **Vendas** da visão pronta (KPIs faturado/ticket médio/conversão, faturamento por dia, vendas por atendente com tabela) usa `overview.sales`, que vem da tabela `sales`.
- **Detalhamento de vendas** (`components/reports/SalesDetails.tsx`, hook `useSaleDetails`) fica abaixo da seção Vendas, com período próprio (Hoje/7/30 dias/Personalizado), dropdown de atendente e busca por cliente/número/produto (debounce 350 ms). Resumo do filtro ativo (produtos vendidos, faturamento, ticket médio) vale para todas as páginas; clicar na linha expande os itens.

## Padrões

- Componentes de página são `'use client'` (dependem de estado e socket).
- Texto de UI em português; nomes de código em inglês.
- Cores em `tailwind.config.ts`: `brand` (verde), `surface` (fundos/bordas). Fundo do chat: classe `.chat-bg` em `globals.css`.
- Erros de mutação: `toast.err(err)`; sucesso: `toast.ok('…')` (`components/ui/Toast.tsx`). Confirmações destrutivas usam `ConfirmDialog`, nunca `window.confirm`.
- `useMe()` dá role/nome do usuário logado; telas escondem ações de admin quando `role === 'agent'` (o back também bloqueia — a UI é só conveniência).
- Respostas rápidas comunicam com o composer por um `CustomEvent('atendo:insert-text')` — evita acoplar os dois painéis.
- O `ChatPane` carrega a conversa por id (`useConversation`), não a procura na lista — assim ela não some quando muda de status. Responder uma conversa em *Aguardando* **não troca a aba**: trocar para *Em atendimento* fazia a lista inteira "sumir" (depois de restaurar o histórico tudo volta para a fila, e em *Em atendimento* só estava a recém-respondida). Em vez disso, a conversa aberta que deixa de casar com o filtro fica **fixada no topo** da lista (`ConversationList` → `fixada`, com os dados frescos de `useConversation`) até trocar de conversa ou de filtro. O envio atualiza só a linha dela nas listas em cache (`moverConversaParaTopo`: prévia, hora e topo na ordem *recentes*); as outras linhas ficam intactas e o refetch do socket corrige o resto. *Assumir* continua levando para *Em atendimento* — é ação explícita de posse.
- Posse: em *Aguardando* o cabeçalho tem **Assumir**; em *Em atendimento* (dono ou admin) tem **Transferir** (menu com atendentes + *Devolver à fila*). Se outra atendente é dona, o composer vira um aviso. A aba chama-se **Atendendo** para todos os perfis (o atendente comum continua vendo só as dele); admin tem um seletor "Todos / Só as minhas / <atendente>".
- **Nota interna** (permissão `conversations.internal_note`): passagem de bastão, orientação de orçamento, observações — só a equipe vê, nunca vai ao WhatsApp. Fica sempre à vista como **aba** logo acima do campo: *Mensagem para o cliente* (padrão) | *Nota interna* 🔒 (`AbasDoEnvio`). Também liga por **Alt+N** (usa `e.code`, porque no Mac Alt+N é tecla morta) ou pelo botão "Nota interna" nas barras em que não dá para responder (encerrada, número desconectado, cota). Ligado, o composer vira âmbar com borda tracejada, a aba fica dourada com *"Visível só para a equipe"* e o botão vira **Adicionar nota** (`POST …/notes`); Esc ou a aba *Mensagem para o cliente* saem. O texto da nota é um estado **separado** do da resposta — desligar o modo nunca transforma a nota em mensagem ao cliente. Sem anexo, áudio, assinatura nem resposta rápida com contagem no modo nota. Reseta ao trocar de conversa.
- Cadeado (conversa de outra pessoa): ninguém responde ao cliente por ela; quem tem a permissão de nota vê o cadeado no lugar do composer e abre o modo nota; quem não tem vê só o aviso de quem está atendendo.
- Bolha de nota na timeline: centralizada, fundo âmbar, borda tracejada, ícone de nota, cabeçalho *"Nota interna adicionada por <nome>"* + horário e rodapé 🔒 *"Visível apenas para a equipe"*. Nome vem de `author.name` e, se o usuário foi removido, de `authorName` (gravado na nota). Sem nenhum dos dois = *"Aviso automático do sistema"* (fluxo, agenda). Chega em tempo real pelo evento `message` do socket, como qualquer mensagem.
- Número desconectado: o composer é substituído por um aviso com link para *Números* (o back também recusa o envio). Mensagens com `status: failed` mostram o erro e o botão **Tentar novamente** (`POST …/resend`). Todo envio do chat leva uma `idempotencyKey` (UUID por envio). Resposta rápida escolhida sai após contagem com Cancelar/Editar (`QuickReplyCountdown`, ver [Envio](envio.md#respostas-rápidas)).
- Prévia da última mensagem (lista e Kanban): sempre via `formatPreview` (`lib/utils.ts`) — a API grava `[tipo]` quando não há texto e o helper traduz (`[image]` → "📷 Imagem", `[unknown]` → "Mensagem"; vazio → "Sem mensagens"). Prévias novas já saem traduzidas da API (`messagePreview` do shared: texto, ou "📍 Nome do lugar", "👤 Maria", "Mensagem interativa"…); o helper fica para as linhas antigas.
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


## Ver imagem e vídeo em tela cheia

Clicar numa imagem do histórico — ou no botão ⤢ no canto de um vídeo — abre o
`MediaViewerModal` (`components/chat/MediaViewer.tsx`) **sobre o chat**, não uma aba nova:
abrir fora tirava o atendente da conversa, que depois voltava e tinha de achar o lugar de
novo. O vídeo continua tocando na própria bolha (o clique nele é do player); ao expandir, o da
bolha pausa e o do visualizador começa sozinho, com os controles nativos completos (play/pausa,
barra, volume, tela cheia do navegador).

Fecha com `Esc`, no X ou clique no fundo — **clicar na mídia não fecha**, senão olhar de perto
(ou dar play) fecharia sem querer. As setas (e `←` / `→`) percorrem as outras imagens e vídeos
da mesma conversa (mensagens apagadas ficam de fora); com o foco no vídeo, `←` / `→` são do
player. **Imagem tem zoom** (`ZoomableImage`): roda do mouse/pinça e duplo clique ampliam na direção
do cursor, botões − / + / tamanho original / girar 90° na barra de baixo, teclas `+` `-` `0`;
ampliada, arrasta com o mouse. Trocar de imagem zera zoom e giro. **Baixar** busca o arquivo e salva com o nome original (o atributo `download` não vale
para a URL do storage, que é de outro domínio); se o storage recusar a busca, abre em aba nova.


## Respostas rápidas: módulo próprio

A gestão de pastas e respostas ocupava **115 das 222 linhas** da página de Configurações.
Virou rota própria (`/respostas`), no menu lateral. Quem entra em Configurações quer aparência,
horário ou segurança — não manter um catálogo que a equipe usa o dia inteiro.

Editar exige `quick_replies.manage`; sem a permissão a tela mostra o conteúdo e esconde as
ações (a API checa de novo).

Pastas e respostas se reordenam arrastando pelo `GripVertical` (`@hello-pangea/dnd`, o mesmo
do Kanban). Resposta pode ir para outra pasta aberta; pasta fechada não recebe, porque não dá
para ver onde ela cairia. A árvore nova vai direto para o cache `['quick-replies']` (sem
"pulo" de volta) e só depois para `PATCH .../reorder`; se a API recusar, o cache é recarregado.
O painel do chat e o menu `/` só repetem a ordem que vem da API.

## Preferências de tela

`usePersistedState` (`lib/persisted.ts`) guarda no navegador o que o atendente ajusta e espera
reencontrar: pasta aberta no painel de respostas, aba escolhida (Mensagens/Fluxos), menu
recolhido.

Uma armadilha vale registrar: gravar a cada mudança de valor **apaga o que acabou de ser
lido**. Na montagem, o efeito de escrita roda no mesmo ciclo do de leitura e ainda enxerga o
valor inicial. Por isso o hook só grava depois que o usuário mexeu, marcado no próprio setter
— depender da ordem dos efeitos não resolve.

## Kanban (`/kanban`)

`app/(app)/kanban/page.tsx` + `components/kanban/`. Uma coluna por tag com `isKanban`, na ordem de `position`, mais a coluna fixa "Sem etapa" (`KANBAN_NO_STAGE`, não é tag). O card fica **só** na coluna da tag principal; as outras tags do atendimento viram pílulas, e as do contato (📌) aparecem só para leitura.

- Arrastar card (`@hello-pangea/dnd`) → `useSetPrimaryTag` → `PATCH /conversations/:id/primary-tag`, otimista no cache `['kanban']` e desfeito se a API recusar. Ordem dentro da coluna não é guardada (manda a última mensagem).
- Clicar numa pílula que é etapa promove a tag e move o card. Pílula de tag que não é etapa fica desabilitada.
- Arrastar colunas só para quem tem `tags.manage` (`PATCH /kanban/columns`); sem a permissão o arraste de colunas nem é montado.
- Duplo clique (ou o botão no card, para o celular) abre `KanbanChatDialog`, que é o próprio `ChatPane` em modo embutido (`<ChatPane conversationId=…/>`): não lê nem mexe na seleção/filtros da tela de conversas. Envio, cota do plano, janela de 24h e posse são os mesmos do chat.
- Não é feature paga e não tem limite próprio: se a cota de mensagens acabar, o `UsageBanner` global e o composer do mini-chat bloqueiam igual à tela de conversas.

No chat, a tag principal aparece cheia e com estrela no `TagPicker` (não fica mais repetida ao lado do nome no cabeçalho — sobrepunha o nome) (clicar numa tag de coluna já selecionada a torna principal) e no card da `ConversationList`.

No card da `ConversationList` a linha de tags é única e tem altura fixa (`flex-nowrap`, `h-5`, pílulas com `truncate`), para todos os cards terem a mesma altura. Aparecem no máximo **2 tags** (`TAGS_NO_CARD`), nesta ordem: principal, demais do atendimento, depois as do contato (📌). O resto vira uma pílula `+N`; no hover, um tooltip mostra nome e cor das ocultas. Ele é renderizado por portal com `position: fixed` para a rolagem da lista não cortá-lo. O limite vale **só para o card**: o cabeçalho do chat e a ficha do contato continuam mostrando todas as tags.

