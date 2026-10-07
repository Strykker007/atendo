/**
 * Envio frio (docs/envio.md#envio-frio): mensagem para quem não escreveu nas últimas 24h.
 *
 * É a causa nº 1 de banimento no número não oficial (Evolution). A regra: no não oficial só
 * sai mensagem para quem escreveu naquele número nas últimas 24h (a mesma janela da Meta);
 * falar primeiro com quem não escreveu é só pelo número oficial, com template aprovado e o
 * recurso `proactive_messaging` no plano. Exceção: lembretes e avisos da Agenda — o cliente
 * pediu o contato ao agendar, o texto é esperado e o volume é baixo.
 */
export const COLD_WINDOW_MS = 24 * 60 * 60 * 1000;

export const isWarm = (lastInboundAt: Date | null | undefined, now = Date.now()) => !!lastInboundAt && now - lastInboundAt.getTime() < COLD_WINDOW_MS;

export const COLD_UNOFFICIAL_MESSAGE =
  'Este contato não escreve neste número há mais de 24 horas. Para proteger o número de bloqueio, ' +
  'mensagem para quem não escreveu só sai pelo número oficial (API da Meta), em "Iniciar conversa". ' +
  'Assim que o contato responder, a conversa volta a funcionar normalmente aqui.';
