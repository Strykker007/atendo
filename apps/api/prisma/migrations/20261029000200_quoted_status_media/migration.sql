-- Foto/vídeo do status respondido, guardada no nosso storage (o story some em 24h)
ALTER TABLE "messages" ADD COLUMN "quotedMediaUrl" TEXT;
ALTER TABLE "messages" ADD COLUMN "quotedMediaMime" TEXT;
