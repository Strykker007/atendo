# Evolution com patches (infra/evolution/*.mjs; docs/04-providers-whatsapp.md#versão-da-evolution):
#  - nó <biz> no Baileys: botões nativos (Pix "Copiar chave Pix") aparecem no celular;
#  - restart de instância que reconecta socket zumbi ("conectado" sem enviar nem receber).
# A versão continua FIXA: trocar a tag aqui só depois de testar — cada patch falha o build se o
# trecho que ele altera mudar.
FROM evoapicloud/evolution-api:v2.3.7
COPY patch-baileys-biz.mjs patch-evolution-restart.mjs /tmp/
RUN node /tmp/patch-baileys-biz.mjs && node /tmp/patch-evolution-restart.mjs && rm /tmp/patch-*.mjs
