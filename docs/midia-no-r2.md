# Mídia no Cloudflare R2

Fotos, áudios, vídeos e documentos saem do disco da VM da Oracle e vão para um bucket **privado** no
R2. As chaves continuam as mesmas (`media/<tenant>/<aaaa-mm>/<uuid>.<ext>`), então banco e
mensagens não mudam.

## Como funciona (e por que não fica mais lento)

```
painel  ──GET /media/...?exp&sig──▶  API  (confere a NOSSA assinatura)
                                      │ ainda no disco? (só com STORAGE_LOCAL_FALLBACK)
                                      ├─ sim → serve do disco, como antes (200/206)
                                      └─ não → 302 para URL pré-assinada do R2
painel  ◀───────── arquivo direto do R2 (Range, cache) ─────────┘
```

- **A API não carrega o arquivo.** Antes, o `GET /media` lia o arquivo inteiro para servir. Com o R2
  atrás disso, cada pedaço de vídeo pedido pelo player baixaria o vídeo todo do bucket. Agora ela
  só confere a assinatura e redireciona.
- **Cache igual ao de hoje.** A URL pré-assinada é assinada com o **início da janela de 30 min**
  (`StorageService.locate`), então a mesma mídia tem a mesma URL durante a janela, como as nossas URLs
  (`signedUrl`). O próprio 302 vai com `Cache-Control: private, max-age=<resto da janela>`.
- **Nome do download e HTML recebido:** `?dl=` vira `response-content-disposition` da URL do R2. HTML,
  SVG, JS e XML (pela extensão da chave) saem como anexo. Mesmo aberto, rodaria no domínio do R2,
  nunca no da API.
- **Worker, IA e transmissões** (`storage.get`) leem do R2, com um pouco mais de latência na fila
  (no navegador, nada muda).
- **Migração sem buraco:** com `STORAGE_LOCAL_FALLBACK=true`, o que ainda está no disco sai do disco,
  e o que não está sai do R2. Arquivo novo vai sempre para o R2. As chaves nunca são reescritas
  (`makeKey` é aleatório), então o disco nunca tem uma versão velha de nada.

## Passo a passo no Cloudflare (R2)

1. **Criar o bucket:** *R2 Object Storage → Create bucket*.
   - Nome: o mesmo do `S3_BUCKET` do `.env.production` (o exemplo usa `atendo-media`). Não use o
     bucket do backup.
   - Location: *Automatic*. Se oferecer dica de região, a mais perto do Brasil costuma ser *Eastern
     North America (ENAM)*.
   - Storage class: *Standard*.
2. **Deixar privado:** em *Settings*, **não** ative *Public access / r2.dev* nem *Custom domain*.
   Quem libera cada arquivo é a assinatura.
3. **CORS** (*Settings → CORS Policy → Add*). É necessário para a onda do áudio e para o "Baixar",
   que usam `fetch`. Depois de um redirecionamento entre domínios o navegador manda `Origin: null`,
   por isso `*`. A segurança fica na assinatura da URL.

   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["Range"],
       "ExposeHeaders": ["Content-Length", "Content-Range", "Content-Type", "Accept-Ranges"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
4. **Token de API:** *R2 → Manage R2 API Tokens → Create API token*.
   - Permissão: **Object Read & Write**.
   - *Specify bucket(s)*: **só** o bucket da mídia.
   - TTL: sem vencimento. Se colocar vencimento, anote na agenda: quando vencer, a mídia para.
   - Copie o **Access Key ID** e o **Secret Access Key**. O secret só aparece uma vez.
   - Use um token separado do backup (`BACKUP_S3_*`). Cada um vê só o seu bucket.
5. **Endpoint:** é o *S3 API* da conta, `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Já está no
   `S3_ENDPOINT` de produção.
6. **(Recomendado) Bucket lock:** *Settings → Bucket lock rules*, prefixo `media/`, retenção de 30
   dias. O Atendo nunca apaga mídia do bucket; a regra protege contra apagar por engano com o
   token. Com a mídia no R2, o backup diário deixa de copiar mídia (`backup.sh` só copia o disco
   local).

## Passo a passo no servidor

Tudo em `~/atendo`, nesta ordem:

1. **Folga de disco agora** (cerca de 13 GB): `docker builder prune -f && docker image prune -f`.
2. **`.env.production`:**
   ```
   STORAGE_DRIVER=s3
   S3_ACCESS_KEY_ID=<do passo 4>
   S3_SECRET_ACCESS_KEY=<do passo 4>
   STORAGE_LOCAL_FALLBACK=true
   ```
   O volume `./volumes/storage:/app/storage` continua montado: é de onde o fallback lê.
3. **Deploy desta versão** e reinício de **api e worker** (os dois leem o `.env`).
4. **Conferir no painel, antes de copiar:**
   - Mídia antiga abre (vem do disco): na aba *Rede*, `GET /media/...` responde **200**.
   - Mídia nova (mande uma foto pelo painel) responde **302** para `…r2.cloudflarestorage.com/…`,
     e a foto abre.
   - Áudio novo toca e desenha a onda; vídeo novo avança no meio; "Baixar" sai com o nome certo.
   - Se der 403 ou "SignatureDoesNotMatch" no R2, confira o token, o bucket e o relógio do servidor.
5. **Copiar o que está no disco**, que é retomável. Rode primeiro um teste com um cliente pequeno
   (`--prefix media/<tenantId>`), depois tudo. Use `tmux` ou `nohup`, porque leva de uma a duas
   horas para cerca de 1,2 milhão de arquivos:
   ```bash
   S="docker compose -f infra/docker-compose.prod.yml --env-file .env.production run --rm --no-deps -v $PWD/apps/api/scripts/storage-to-s3.mjs:/app/storage-to-s3.mjs:ro api node storage-to-s3.mjs"
   $S copy                                  # simulação: quantos arquivos e GB faltam
   nohup $S copy --apply --concurrency 16 > ~/midia-copy.log 2>&1 &
   tail -f ~/midia-copy.log
   ```
   O script envia cada arquivo com o `Content-Type` do `.mime` ao lado. Por isso não é um `rclone`
   puro: os `.mime` não sobem e o tipo não é adivinhado pela extensão. Ele pula o que já está no
   bucket com o mesmo tamanho. Se cair, rode de novo. Se estiver pesando no app, baixe o
   `--concurrency`.
6. **Conferir:** `$S verify` tem que terminar com `faltando 0`. A lista do que falta e os erros
   ficam em `infra/volumes/storage/storage-to-s3-erros.log`. Rode `copy --apply` de novo até zerar.
7. **Apagar do disco em ondas**, sempre só o que está no bucket com o mesmo tamanho:
   ```bash
   $S delete-local --older-than-days 60              # simulação
   $S delete-local --older-than-days 60 --apply      # abra conversas antigas no painel e confira
   $S delete-local --older-than-days 7 --apply
   $S delete-local --apply
   df -h /
   ```
8. **Na versão seguinte**, com o disco vazio de mídia: `STORAGE_LOCAL_FALLBACK=false` (deixa de
   consultar o disco a cada mídia).

## Voltar atrás

- **Antes do passo 7** (o disco ainda tem tudo o que é antigo): volte `STORAGE_DRIVER=local` e
  reinicie. O que entrou depois da troca está só no R2. Para trazer de volta, use o container de
  backup, que já tem o `rclone`: `rclone copy r2:<bucket>/media infra/volumes/storage/media`. Os
  `.mime` desses arquivos não existem; sem eles o disco serve `application/octet-stream`, e
  imagens ainda abrem.
- **Depois do passo 7:** só com o R2. Não há volta sem copiar tudo de volta.

## Custo

Cerca de US$ 0,015 por GB por mês, sem custo de saída (o navegador baixa direto do R2 de graça).
Com 78 GB hoje e ~2,6 GB/dia (27/11/2026), dá uns US$ 1,20/mês, subindo uns US$ 1,20 por mês a
cada mês. A cópia inicial custa ~1,2 milhão de PUTs (operação classe A, ~US$ 4,50 por milhão).
Entra no custo por cliente.

## Onde está no código

- `apps/api/src/common/storage/storage.service.ts`: `put`, `get` (com o fallback), `locate` (URL
  pré-assinada estável na janela) e `signedUrl`/`verify` (a nossa assinatura).
- `apps/api/src/modules/media/media.controller.ts`: `GET /media/*`, que redireciona (302) ou serve
  do disco.
- `apps/api/scripts/storage-to-s3.mjs`: cópia, conferência e limpeza do disco.
- Variáveis: `STORAGE_DRIVER`, `S3_*`, `STORAGE_LOCAL_FALLBACK` (`config/env.ts`).
