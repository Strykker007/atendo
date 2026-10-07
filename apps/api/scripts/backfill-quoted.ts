import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { InboundMessage } from '@atendo/shared';
import { WorkerModule } from '../src/worker.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { StorageService } from '../src/common/storage/storage.service';
import { NumbersService } from '../src/modules/whatsapp/numbers.service';
import { ProviderRegistry } from '../src/modules/whatsapp/providers/provider.registry';
import type { MediaPayload } from '../src/modules/whatsapp/providers/provider.interface';
import { lerCitacao } from '../src/modules/whatsapp/providers/quoted';
import { desembrulhar } from '../src/modules/whatsapp/providers/evolution-content';

// Reprocessa a citação de mensagens recebidas pela Evolution que chegaram em texto puro
// (`conversation`) com o `contextInfo` no topo do webhook — antes do `contextoDaCitacao` elas
// eram gravadas sem citação (a resposta a status virava texto solto). Lê do `raw` salvo.
//
// Por padrão só SIMULA e lista o que mudaria; `--apply` grava. Idempotente: só pega mensagem
// sem `quotedId`. Status com foto/vídeo: tenta baixar a mídia (só funciona dentro das 24h do
// story); senão guarda a miniatura que veio no payload.
//
// Roda COMPILADO, como o stripe-sync (o tsx não emite os metadados da injeção do Nest):
//   pnpm --filter @atendo/api quoted:backfill            # simula
//   pnpm --filter @atendo/api quoted:backfill -- --apply # grava
async function main() {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);
  const storage = app.get(StorageService);
  const numbers = app.get(NumbersService);
  const registry = app.get(ProviderRegistry);

  const rows = await prisma.$queryRaw<{ id: string; tenantId: string; numberId: string; externalId: string; raw: any }[]>`
    SELECT m.id, c."tenantId", m."numberId", m."externalId", m.raw
    FROM messages m
    JOIN conversations c ON c.id = m."conversationId"
    JOIN whatsapp_numbers n ON n.id = m."numberId"
    WHERE m.direction = 'in'
      AND m."quotedId" IS NULL
      AND n.provider = 'evolution'
      AND m.raw -> 'contextInfo' ->> 'stanzaId' IS NOT NULL`;

  let corrigidas = 0, comMidia = 0;
  for (const r of rows) {
    const citacao = lerCitacao(desembrulhar(r.raw?.message), r.raw?.contextInfo);
    if (!citacao?.externalId) continue;
    corrigidas++;
    console.log(`${apply ? 'corrigindo' : '[simulação]'} ${r.id} ${citacao.fromStatus ? 'status' : 'citação'}: ${citacao.preview ?? '—'}`);
    if (!apply) continue;

    const citada = await prisma.message.findFirst({ where: { externalId: citacao.externalId, conversation: { tenantId: r.tenantId } }, select: { id: true } });
    await prisma.message.update({
      where: { id: r.id },
      data: { quotedId: citacao.externalId, quotedMessageId: citada?.id ?? null, quotedPreview: citacao.preview, quotedFromStatus: citacao.fromStatus },
    });

    if (!citacao.fromStatus || !citacao.media) continue;
    let media: MediaPayload | null = null;
    try {
      const ctx = await numbers.context(r.numberId);
      const provider = registry.get(ctx.provider);
      const msg = { externalId: r.externalId, quotedFromStatus: true, quotedMedia: citacao.media, raw: r.raw } as InboundMessage;
      if (provider.fetchQuotedMedia) media = await provider.fetchQuotedMedia(ctx, msg);
    } catch { /* story expirado ou número desconectado: fica a miniatura */ }
    if (!media && citacao.media.thumbnail) media = { data: Buffer.from(citacao.media.thumbnail, 'base64'), mimeType: 'image/jpeg' };
    if (!media) continue;
    const key = storage.makeKey(r.tenantId, media.mimeType);
    await storage.put(key, media.data, media.mimeType);
    await prisma.message.update({ where: { id: r.id }, data: { quotedMediaUrl: key, quotedMediaMime: media.mimeType } });
    comMidia++;
  }

  await app.close();
  console.log(`${rows.length} candidatas, ${corrigidas} com citação${apply ? `, ${comMidia} com mídia do status guardada` : ' — rode com --apply para gravar'}.`);
}
main();
