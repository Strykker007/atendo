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
│       ├── configuracoes/  pastas e respostas rápidas (CRUD)
│       └── relatorios/     (placeholder)
├── components/
│   ├── layout/Sidebar.tsx | UsageBanner.tsx (aviso global 80/100%, past_due, suspended)
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
| Mutação (salvar, enviar) | Botão desabilitado + texto "Salvando…"/"Criando…" | cada formulário |

Em **dev** o Next compila cada rota no primeiro acesso, por isso a primeira troca de tela demora alguns segundos; em produção (`pnpm build && pnpm start`) é quase instantâneo e os links são pré-carregados.

## Padrões

- Componentes de página são `'use client'` (dependem de estado e socket).
- Texto de UI em português; nomes de código em inglês.
- Cores em `tailwind.config.ts`: `brand` (verde), `surface` (fundos/bordas). Fundo do chat: classe `.chat-bg` em `globals.css`.
- Erros de mutação: `toast.err(err)`; sucesso: `toast.ok('…')` (`components/ui/Toast.tsx`). Confirmações destrutivas usam `ConfirmDialog`, nunca `window.confirm`.
- `useMe()` dá role/nome do usuário logado; telas escondem ações de admin quando `role === 'agent'` (o back também bloqueia — a UI é só conveniência).
- Respostas rápidas comunicam com o composer por um `CustomEvent('atendo:insert-text')` — evita acoplar os dois painéis.
- O `ChatPane` carrega a conversa por id (`useConversation`), não a procura na lista — assim ela não some quando muda de status. Ao responder uma conversa em *Aguardando*, o filtro muda sozinho para *Em atendimento* mantendo a seleção (`setStatus(s, keep)`).
- Mídia: `MediaBody` renderiza imagem/áudio/vídeo/documento a partir de `mediaUrl` (assinada, expira em 1 h — ao expirar, refetch das mensagens renova). Anexo no composer: `uploadFile()` → prévia → envio com `mediaKey`.
