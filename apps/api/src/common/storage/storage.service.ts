import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../../config/env';

export interface StoredObject {
  data: Buffer;
  mimeType: string;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/ogg; codecs=opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'application/pdf': 'pdf',
};

/**
 * Armazena mídia de forma privada. Dois drivers, escolhidos por STORAGE_DRIVER:
 *   local → disco (dev, grátis)      s3 → qualquer S3-compatível (R2, S3, MinIO)
 * A chave (`key`) é o que fica em Message.mediaUrl; o navegador recebe uma URL assinada e temporária.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger(StorageService.name);
  private readonly s3 = env.STORAGE_DRIVER === 's3'
    ? new S3Client({
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT || undefined,
        forcePathStyle: !!env.S3_ENDPOINT,
        credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      })
    : null;

  /** Gera uma chave única: media/<tenant>/<yyyy-mm>/<uuid>.<ext> */
  makeKey(tenantId: string, mimeType: string, fileName?: string) {
    const ext = EXT_BY_MIME[mimeType] ?? (fileName ? extname(fileName).replace('.', '') : '') ?? 'bin';
    const period = new Date().toISOString().slice(0, 7);
    return `media/${tenantId}/${period}/${randomUUID()}${ext ? '.' + ext : ''}`;
  }

  async put(key: string, data: Buffer, mimeType: string) {
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: data, ContentType: mimeType }));
    } else {
      const path = this.localPath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
      await writeFile(path + '.mime', mimeType);
    }
    this.log.debug(`stored ${key} (${data.length} bytes)`);
  }

  async get(key: string): Promise<StoredObject> {
    if (this.s3) {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      return { data: Buffer.from(await r.Body!.transformToByteArray()), mimeType: r.ContentType ?? 'application/octet-stream' };
    }
    const path = this.localPath(key);
    const [data, mimeType] = await Promise.all([readFile(path), readFile(path + '.mime', 'utf8').catch(() => 'application/octet-stream')]);
    return { data, mimeType };
  }

  // ---- URLs assinadas: o navegador não manda header em <img>, então a autorização vai na query ----

  /** URL válida por `ttlSeconds` (padrão 1h). A chave já começa com media/, servida por GET /media/*path?exp&sig */
  signedUrl(key: string, ttlSeconds = 3600) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(key, exp);
    return `${env.API_PUBLIC_URL}/${key}?exp=${exp}&sig=${sig}`;
  }

  verify(key: string, exp: string, sig: string) {
    if (!/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
    const expected = this.sign(key, Number(exp));
    return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }

  private sign(key: string, exp: number) {
    return createHmac('sha256', env.ENCRYPTION_KEY).update(`${key}:${exp}`).digest('hex');
  }

  private localPath(key: string) {
    // impede path traversal: a chave sempre começa com media/ e não tem ".."
    if (!key.startsWith('media/') || key.includes('..')) throw new Error('chave de mídia inválida');
    return resolve(process.cwd(), env.STORAGE_LOCAL_DIR, key);
  }
}
