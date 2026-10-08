# 19 — Marcas e vertentes (white-label)

O mesmo código pode servir mais de uma **marca** — uma vertente do produto com outra cara (ex.: uma versão "para clínicas"), em outro domínio ou subdomínio. Hoje só existe a **VogoChat** (`vogochat`); o mecanismo está pronto para as próximas.

> **O que a marca muda:** logo, cores, nome do produto, título da aba e favicon do painel.
> **O que não muda:** API, banco, planos, cobrança, e-mails e clientes são os mesmos para todas as marcas. Ver [Limites atuais](#limites-atuais).

## Onde fica

| Peça | Arquivo |
|---|---|
| Config das marcas (`BRANDS`) e resolução | `apps/web/src/lib/brand.ts` |
| Contexto no cliente (`useBrand()`) | `apps/web/src/lib/brand-context.tsx` |
| Injeção de cores, título e favicon | `apps/web/src/app/layout.tsx` |
| Logos (`MarcaHorizontal`, `MarcaMenu`, `MarcaIcone`) | `apps/web/src/components/ui/Marca.tsx` |
| Arquivos de logo | `apps/web/public/marca/` (base) e `public/marca/<id>/` (demais) |

## Campos de uma marca

| Campo | Para quê |
|---|---|
| `brandId` | id curto, minúsculo (`vogochat`). É o valor de `NEXT_PUBLIC_BRAND_ID`. |
| `brandName` | nome exibido: título da aba, aviso de nova versão, Financeiro, Clientes, checkout. |
| `logo.horizontal` / `logo.horizontalDark` | login, convite e recuperação de senha (tema claro / escuro). |
| `logo.sidebar` | menu lateral — o fundo é escuro nos dois temas, então a arte precisa de texto claro. |
| `logo.icon` | só o símbolo, para o menu recolhido. |
| `faviconUrl` | ícone da aba. |
| `primaryColor` | botões, links, foco, primeira cor dos gráficos (`--accent`). |
| `secondaryColor` | fundo do menu lateral (`--side`). |
| `accentColor` | balão de mensagem enviada (`--bub-out`). |
| `supportEmail` | contato de suporte da marca. |
| `domains` | domínios que abrem esta marca (subdomínios incluídos). |

Todos os campos de `logo` e o `faviconUrl` são opcionais: sem arte, o painel mostra o nome da marca em texto (e a inicial, num quadrado na cor primária, no menu recolhido). Dá para subir a vertente antes de ter a logo.

## Qual marca abre

1. **`NEXT_PUBLIC_BRAND_ID` preenchida** → essa marca, sempre. Entra no **build** do web (como os outros `NEXT_PUBLIC_*`): use para uma instância separada só daquela vertente.
2. **Vazia** → o root layout lê o host da requisição (`x-forwarded-host`, senão `host`) e procura em `domains`. Subdomínios casam (`app.exemplo.com.br` casa com `exemplo.com.br`) e vence o domínio **mais específico**: uma marca com `clinica.vogochat.com.br` ganha da VogoChat em `vogochat.com.br`.
3. **Nada casou** (ex.: `localhost`, IP) → VogoChat.

Ler o host deixa as páginas dinâmicas (renderizadas a cada acesso). Com a env fixa, o layout nem lê o host.

Para testar outra marca localmente: `NEXT_PUBLIC_BRAND_ID=<id>` no `.env` e reiniciar o web (o Next cacheia `NEXT_PUBLIC_*`; se não pegar, `rm -rf apps/web/.next`).

## Cores

Os componentes **não sabem** da marca: usam os tokens de sempre (`bg-accent`, `bg-side`, `bg-chat-out` — ver [08 — Front-end](08-frontend.md)). O layout injeta um `<style>` gerado por `brandCss()` que sobrescreve as variáveis CSS do `globals.css`:

- `primaryColor` → `--accent`, e daí saem `--accent-hover`, `--accent-soft`, `--accent-ink` e `--c1` via `color-mix`;
- `secondaryColor` → `--side`, `--side-line`, `--side-on-ink`;
- `accentColor` → `--bub-out` e `--bub-out-2` (degradê do balão);
- no tema escuro, as mesmas cores clareadas e os fundos "soft" misturados ao painel escuro.

A VogoChat é a paleta base do `globals.css`, afinada à mão, e **não** recebe sobrescrita. Se uma vertente precisar de ajuste fino além das três cores (ex.: o "soft" ficou forte demais), o lugar é `brandCss()` — não espalhar `if` por componente.

## Criar uma vertente — passo a passo

1. **Config:** nova entrada em `BRANDS` (`apps/web/src/lib/brand.ts`), com `brandId`, `brandName`, as três cores, `supportEmail` e `domains`. `logo: {}` se ainda não houver arte.
2. **Arte (opcional):** PNGs em `apps/web/public/marca/<id>/` — horizontal clara, horizontal escura, versão do menu (texto claro), ícone — e os caminhos em `logo` e `faviconUrl`.
3. **Publicar**, de um dos dois jeitos:
   - **Mesmo deploy, outro domínio:** apontar o DNS do (sub)domínio para o servidor do web, incluir no proxy/TLS e acrescentar a origem em `WEB_EXTRA_ORIGINS` da API (ex.: `https://app.clinica.com.br`, separadas por vírgula). Sem isso o CORS e o socket recusam o painel novo. O painel escolhe a marca pelo host.
   - **Instância separada:** build do web com `NEXT_PUBLIC_BRAND_ID=<id>` (arg do `apps/web/Dockerfile`, repassado em `infra/docker-compose.prod.yml`).
4. **Conferir** login (claro e escuro), menu aberto e recolhido, título/favicon da aba, um balão enviado e um botão primário.

## Regras para código novo

- Nome do produto em texto de UI: `useBrand().brandName`. Nunca escrever "VogoChat" fixo.
- Logo: `MarcaHorizontal` / `MarcaMenu` / `MarcaIcone`. Nunca `<img src="/marca/...">` direto.
- Cor: tokens do Tailwind. Hex direto em componente quebra a marca (e o tema escuro).

## Limites atuais

O que ainda é **igual para todas as marcas** — se uma vertente precisar diferenciar, é trabalho novo:

- **E-mails e links gerados pela API** (convite, recuperação de senha, avisos de cobrança, retorno do Stripe/Asaas) usam o remetente, o texto e o domínio de `WEB_ORIGIN`: quem é de outra vertente cai no domínio principal. A API não sabe de marca — `WEB_EXTRA_ORIGINS` só libera CORS e socket.
- **Clientes não são separados por marca:** o super_admin vê todos os clientes juntos, e um cliente consegue logar por qualquer domínio. Para separar, a marca teria que virar coluna do `Tenant` e entrar no login.
- **Planos e preços** são os mesmos catálogos ([05 — Planos](05-planos-e-cobranca.md)).
- **Chaves de `localStorage`** (tema, velocidade de áudio) não têm prefixo de marca — só importa se duas marcas rodarem no mesmo domínio, o que não é o caso.
