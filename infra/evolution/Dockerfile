# Evolution com patches (infra/evolution/*.mjs; docs/04-providers-whatsapp.md#versão-da-evolution):
#  - nó <biz> no Baileys: botões nativos (Pix "Copiar chave Pix") aparecem no celular;
#  - restart de instância que reconecta socket zumbi ("conectado" sem enviar nem receber);
#  - CVE-2026-48063 no Baileys rc.9 (backport 3beb08e + 5ddc231) e gatilhos de texto
#    requestPlaceholder/onDemandHistSync só pelo próprio celular (docs/26-backport-cve-2026-48063.md);
#  - guarda de conexão: uma conexão por instância, backoff com jitter, 440 sem disputa
#    (atendo/connection-guard.cjs + patch-evolution-connection.mjs; docs/29-reconexao-evolution.md).
# A versão continua FIXA: trocar a tag aqui só depois de testar — cada patch falha o build se o
# trecho que ele altera mudar, e os testes (verify-patches.test.mjs) rodam aqui: se falharem, a
# imagem não é gerada.
FROM evoapicloud/evolution-api:v2.3.7
COPY atendo/connection-guard.cjs /evolution/atendo/connection-guard.cjs
COPY patch-baileys-biz.mjs patch-evolution-restart.mjs patch-baileys-cve-2026-48063.mjs patch-evolution-placeholder-triggers.mjs patch-evolution-connection.mjs verify-patches.test.mjs test/connection-guard.test.mjs /tmp/
RUN node /tmp/patch-baileys-biz.mjs \
 && node /tmp/patch-evolution-restart.mjs \
 && node /tmp/patch-baileys-cve-2026-48063.mjs \
 && node /tmp/patch-evolution-placeholder-triggers.mjs \
 && node /tmp/patch-evolution-connection.mjs \
 && ATENDO_GUARD_PATH=/evolution/atendo/connection-guard.cjs node --test /tmp/verify-patches.test.mjs /tmp/connection-guard.test.mjs \
 && rm /tmp/patch-*.mjs /tmp/verify-patches.test.mjs /tmp/connection-guard.test.mjs
