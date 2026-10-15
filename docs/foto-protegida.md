# Foto protegida (link no lugar da mídia)

Farmácia manda foto de remédio, caixa e receita o dia inteiro pelo WhatsApp. Esse é o tipo de
mídia que mais pesa na detecção de venda de medicamento e leva número a banimento. A foto
protegida tira a imagem da conversa: no WhatsApp vai só um **texto genérico com um link**, e a
foto (com a legenda) fica numa página do Atendo que **expira**.

> Reduz muito o risco, mas não zera: o número continua sendo julgado também pelo volume, pelas
> denúncias e pelo texto das mensagens. O texto do aviso não cita o conteúdo, e a página não
> gera prévia de imagem.

## No chat

Ao escolher, arrastar ou colar imagem, vídeo ou PDF, a **tela de prévia** (`MediaPreview`) mostra
**Enviar como link protegido** acima da legenda. O mesmo vale para mídia que entra pelo campo
(resposta rápida com anexo), na barra do anexo:

- Marcado, aparece **válido por** (1 h, 4 h, 12 h, **1 dia** — padrão —, 3 dias, 7 dias). O
  atendente escolhe a cada envio; a validade volta para 1 dia no próximo anexo.
- A escolha de marcar fica **lembrada no navegador** (`useUI.securePhotos`): a farmácia marca uma
  vez e as próximas fotos já saem protegidas; desmarca para foto sem risco.
- A **legenda** vai só para a página, nunca para o WhatsApp (pode citar o remédio).
- Ao enviar: `POST /conversations/:id/secure-media` guarda o link e devolve em `text` a frase
  pronta; o painel envia esse texto pelo caminho normal do chat (quota, janela de 24h da Meta,
  `UsageService`, assinatura do atendente). Frase padrão (`SECURE_MEDIA_TEXT_DEFAULT`):
  > Olá Ana, a imagem está disponível neste link (válido por 1 dia): https://<domínio do painel>/f/<hash>

  O painel manda o próprio endereço (`linkBase`), então o link sai no domínio da marca que o
  atendente usa, como no orçamento.

## Configuração

Em **Configurações → Empresa → Páginas para o cliente** (`settings.manage`):

- **Frase da foto protegida** (`tenant_settings.secureMediaText`): com `{{link}}` (obrigatório — a
  API recusa sem ele), `{{validade}}` ("1 dia", "4 horas") e `{{primeiro_nome}}` (sem nome, some
  junto com o espaço antes). Vazio = a frase padrão. A tela mostra a prévia. Evitar citar o
  conteúdo da foto: o texto é o que o WhatsApp lê.
- **Logo da empresa** (`tenant_settings.publicLogoKey`, upload do painel; PNG, JPG ou WEBP até
  2 MB): aparece no topo da **foto protegida** e do **orçamento** (`/o/:hash`), em URL assinada de
  10 min (`logoUrl`). Sem logo, a marca do painel (VogoChat). SVG não é aceito (página aberta).
  Migration `20261211000000_public_page_branding`.

Na bolha da mensagem enviada, o **SecureMediaChip** mostra a foto (a equipe continua vendo
depois de expirar), a situação (até quando vale / expirado / revogado), quantas vezes o contato
abriu e quando abriu pela primeira vez, e o botão **revogar** (tira do ar na hora: foto errada,
pessoa errada).

## Página pública `/f/:hash`

Sem login: o `hash` (128 bits aleatórios, base64url de 22 caracteres) é a credencial.

- Topo: logo da empresa (ou a marca do painel).
- Ativa: imagem (ou vídeo/PDF), legenda, "Disponível até …", nome do atendente e da empresa.
  A mídia vem em URL assinada de **10 minutos** (`SIGNED_TTL_S`) — copiar o endereço da imagem
  não vira um link permanente.
- Expirada ou revogada: só o aviso para pedir de novo. Nem a legenda aparece.
- Prévia do link no WhatsApp: título genérico "Conteúdo do atendimento", sem `og:image`
  (`app/f/layout.tsx`); `noindex`.
- Cada abertura ativa soma `viewCount` e grava `firstViewedAt` na primeira.
- Limite de 30 pedidos/min por IP.

## API

| Método | Rota | O que faz |
|---|---|---|
| GET | `/conversations/:id/secure-media` | Links da conversa (até 100), com URL assinada para a equipe |
| POST | `/conversations/:id/secure-media` | `{ mediaKey, mimeType, fileName?, caption?, validHours? (1–168, padrão 24), linkBase? }` → link + `text` (a frase da empresa pronta). `mediaKey` tem que ser do próprio cliente (`media/<tenant>/…`, o que o upload do painel devolve). Tipos: JPG, PNG, WEBP, GIF, HEIC, MP4, PDF. **Não envia nada** |
| POST | `/conversations/:id/secure-media/:mediaId/revoke` | Tira do ar antes da validade |
| GET | `/secure-media/public/:hash` | Página pública (`PublicSecureMedia`). Sem login |

As rotas da conversa passam pelo `ConversationScopeGuard` (número/departamento de fora = barrado).
Sem recurso de plano: é proteção do número, não um extra.

## Modelo

`secure_media` (migration `20261209000000_secure_media`): `tenantId`, `conversationId`,
`contactId`, `userId` + `userName` (sem FK, sobrevive à remoção do usuário), `hash` (único),
`mediaKey`/`mediaMime`/`mediaName` (o arquivo do upload do painel, no storage privado),
`caption`, `validHours`, `expiresAt`, `revokedAt`/`revokedById`, `firstViewedAt`, `viewCount`.
Constantes e o texto do aviso em `packages/shared/src/secure-media.ts`.

## Limites atuais

- Uma mídia por link. Várias fotos = vários links.
- O arquivo continua no storage depois de expirar (o storage não apaga), igual ao comprovante do orçamento.
- O padrão "marcado" é por navegador, não por empresa. Se precisar, vira uma opção em Configurações.
- Não há detecção automática de foto de risco; a IA poderia sugerir marcar (docs/22-agente-ia.md).
