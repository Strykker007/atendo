# 21 — Site (landing page)

A landing pública da **VogoChat** é um app próprio, `apps/site`, separado do painel (`apps/web`): roda em **outro domínio**, com build e deploy independentes. Mexer no texto do site não exige subir o painel, e vice-versa.

## Por que separado

- Domínio diferente do painel: no mesmo app seria preciso middleware por host para o site não abrir `/login`, `/conversas` etc.
- O site não precisa de nada do painel (React Query, socket, leitura do host, white-label): fica estático, leve e bom para SEO.
- Continua no monorepo para reaproveitar a paleta, as fontes e as logos.

## Rodando

| | |
|---|---|
| Dev | `pnpm --filter @atendo/site dev` → http://localhost:3001 (o `pnpm dev` da raiz sobe junto com o painel) |
| Build | `pnpm --filter @atendo/site build` (saída em `.next-build`, `output: 'standalone'`) |
| Env | `NEXT_PUBLIC_APP_URL` — endereço do painel (link "Entrar"; padrão `http://localhost:3000`). `NEXT_PUBLIC_SITE_URL` — endereço do próprio site, para canonical e Open Graph (padrão `https://vogochat.com.br`). Entram no **build**. `apps/site/.env` é link para o `.env` da raiz, como no web. |

## Estrutura

Página voltada a **farmácias**, migrada do site antigo em WordPress/Elementor. Funil: dor → solução → prova social → oferta. Os CTAs do meio da página levam a `#planos`; de lá, o botão final abre o WhatsApp do consultor.

| Peça | Arquivo |
|---|---|
| Página (`/`) e layout (fontes, tema, SEO, dados estruturados) | `src/app/page.tsx`, `src/app/layout.tsx` |
| **Política de privacidade** (`/privacidade`, LGPD; exigida pela Meta no app da API oficial). Exclusão de dados em `/privacidade#exclusao-de-dados`. Data da versão em `ATUALIZADA_EM`; link no rodapé | `src/app/privacidade/page.tsx` |
| Seções, na ordem | `src/components/landing/` — `LandingHeader`, `Hero` (+ `ChatMockup`), `Demo` (vídeo), `Pains`, `Features`, `SocialProof` (logos + contadores), `Extras` (+ vídeo de depoimentos), `Pricing` (oferta + aviso de qualificação), `Faq`, `LandingFooter` — montadas em `LandingPage` |
| **Todos os textos** (hero, dores, recursos, números, oferta, FAQ…) | `src/components/landing/content.ts` |
| Nome, SEO, CNPJ, redes, `APP_URL`, **WhatsApp do consultor** (`WHATSAPP_URL`), IDs dos pixels (`TRACKING`) | `src/lib/site.ts` |
| Cartão "vidro" (`glass`), molde de seção e botão de CTA | `src/components/landing/Section.tsx` |
| Vídeos | `public/videos/` (demonstração 16:9, depoimentos 9:16) |
| Logos de clientes (faixa rolando, CSS `.marquee` em `globals.css`) | `public/clientes/01..16.webp` — o número de logos fica em `CLIENTS.logos` |
| Logo, favicon, imagem de compartilhamento | `public/marca/`, `public/icon.png`, `public/apple-icon.png`, `public/og.webp` |

O preço em `content.ts` (`OFFER`) é texto de vitrine — **não** é o catálogo de cobrança ([05 — Planos](05-planos-e-cobranca.md)). Mudou o preço lá, atualize aqui.

## Pixels e conversão

`src/components/Tracking.tsx` carrega Google Ads (gtag), Meta Pixel e TikTok Pixel — os mesmos IDs do site antigo — **só no build de produção** (`next dev` não envia nada). Todo clique em link do WhatsApp (`wa.me`, `api.whatsapp.com`…) dispara: conversão do Google Ads, `Contact` no TikTok e `Contact` na Meta. Os CTAs do WhatsApp abrem em nova aba, para os eventos terminarem de enviar.

Do WordPress ficaram para trás: a API de Conversões da Meta pelo servidor (plugin PixelYourSite) e o Yoast. O SEO (título, descrição, canonical, Open Graph, verificação do Google, dados estruturados) está no `layout.tsx`.

## Animações ao rolar (demo em `/animado`)

`<LandingPage animated>` liga as animações; hoje só a rota `/animado` usa (fora do Google, `noindex`), para comparar com a `/`. Aprovado, é trocar `src/app/page.tsx` para `<LandingPage animated />` e apagar a rota.

- `src/components/landing/motion.tsx`: `MotionProvider` publica a rolagem em variáveis CSS (`--sy` para parallax, `--sp` para a barra de progresso no topo); `Reveal` faz o elemento entrar quando aparece e se esconder de novo quando sai da tela — a entrada repete a cada volta, em qualquer direção (os contadores também contam de novo) (`up`, `left`, `right`, `zoom`, `blur`, com `delay` para escalonar listas). Sem `animated`, `Reveal` é um wrapper neutro.
- CSS em `globals.css` (bloco "Animações ao rolar"), tudo sob `.motion`. Respeita `prefers-reduced-motion` (mostra tudo parado) e, sem JS, um `<noscript>` mostra tudo.
- `Reveal` envolve o card em vez de animar o próprio card: assim o transform da entrada não briga com o hover.

## Tema e cores

- Mesmos tokens do painel: `src/app/globals.css` tem uma **cópia** do bloco `:root`/`.dark` de `apps/web/src/app/globals.css`, e o `tailwind.config.ts` expõe os mesmos nomes (`bg-panel`, `text-muted`, `bg-accent`…). Mudou a paleta do painel, copie o bloco para cá.
- Nunca hex direto em componente.
- Claro/escuro: sem escolha salva, segue o sistema; o botão do cabeçalho grava em `localStorage` (`vogochat-site-theme`). O script do layout aplica antes do primeiro paint.

## Pendente

- **Deploy:** ainda não há `Dockerfile` do site nem serviço/domínio no `infra/docker-compose.prod.yml` e no Caddy.
- Os vídeos (~33 MB) são servidos pelo próprio app; se o tráfego crescer, vale mover para um CDN/armazenamento externo.
