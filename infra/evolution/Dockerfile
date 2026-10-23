# Evolution com patches (infra/evolution/*.mjs; docs/04-providers-whatsapp.md#versão-da-evolution):
#  - nó <biz> no Baileys: botões nativos (Pix "Copiar chave Pix") aparecem no celular;
#  - restart de instância que reconecta socket zumbi ("conectado" sem enviar nem receber);
#  - CVE-2026-48063 no Baileys rc.9 (backport 3beb08e + 5ddc231) e gatilhos de texto
#    requestPlaceholder/onDemandHistSync só pelo próprio celular (docs/26-backport-cve-2026-48063.md);
#  - guarda de conexão: uma conexão por instância, backoff com jitter, 440 sem disputa
#    (atendo/connection-guard.cjs + patch-evolution-connection.mjs; docs/29-reconexao-evolution.md);
#  - leitura da credencial que falha não vira credencial nova (patch-evolution-creds-read.mjs);
#  - recebimento que não trava no Baileys rc.9: fila com prazo, offline que não morre, NACK
#    (patch-baileys-recv.mjs) e nome da instância nos logs do Baileys (patch-evolution-baileys-logger.mjs)
#    — docs/23-evolution-desempenho.md › 9 e 10;
#  - diagnóstico do recebimento: linha `recv-probe` por socket a cada 5 min, só observa
#    (patch-baileys-recv-probe.mjs) — docs/23-evolution-desempenho.md › 12;
#  - ack da stanza <status> (stories): sem ele o servidor derruba o stream a cada ~50 min e o número
#    para de receber (patch-baileys-status-ack.mjs; Baileys#2858) — docs/23-evolution-desempenho.md › 13.
# A versão continua FIXA: trocar a tag aqui só depois de testar — cada patch falha o build se o
# trecho que ele altera mudar, e os testes (verify-patches.test.mjs) rodam aqui: se falharem, a
# imagem não é gerada.
FROM evoapicloud/evolution-api:v2.3.7
COPY atendo/connection-guard.cjs /evolution/atendo/connection-guard.cjs
COPY patch-baileys-biz.mjs patch-evolution-restart.mjs patch-baileys-cve-2026-48063.mjs patch-evolution-placeholder-triggers.mjs patch-evolution-connection.mjs patch-evolution-creds-read.mjs patch-baileys-recv.mjs patch-baileys-recv-probe.mjs patch-baileys-status-ack.mjs patch-evolution-baileys-logger.mjs verify-patches.test.mjs test/connection-guard.test.mjs /tmp/
RUN node /tmp/patch-baileys-biz.mjs \
 && node /tmp/patch-evolution-restart.mjs \
 && node /tmp/patch-baileys-cve-2026-48063.mjs \
 && node /tmp/patch-evolution-placeholder-triggers.mjs \
 && node /tmp/patch-evolution-connection.mjs \
 && node /tmp/patch-evolution-creds-read.mjs \
 && node /tmp/patch-baileys-recv.mjs \
 && node /tmp/patch-baileys-recv-probe.mjs \
 && node /tmp/patch-baileys-status-ack.mjs \
 && node /tmp/patch-evolution-baileys-logger.mjs \
 && ATENDO_GUARD_PATH=/evolution/atendo/connection-guard.cjs node --test /tmp/verify-patches.test.mjs /tmp/connection-guard.test.mjs \
 && rm /tmp/patch-*.mjs /tmp/verify-patches.test.mjs /tmp/connection-guard.test.mjs
