import { BadRequestException, Controller, Get, Headers, Param, Post, Query, Res, UnauthorizedException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { StorageService } from '../../common/storage/storage.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { env } from '../../config/env';

/**
 * Qualquer arquivo entra (txt, exe, zip, mov…): o que o WhatsApp não mostra como mídia vai como
 * documento (`mediaTypeOf` no front). Só fica de fora conteúdo que o navegador EXECUTA ao abrir —
 * servido pelo domínio da API, um HTML/SVG/JS rodaria script ali.
 */
const ACTIVE_CONTENT = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|(text|application)\/(x-)?(javascript|ecmascript))$/;

@Controller()
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  /** Upload pelo atendente (composer). Devolve a chave + URL assinada para prévia. */
  @Post('uploads')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: env.MEDIA_MAX_MB * 1024 * 1024 } }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Arquivo ausente (campo "file")');
    // o navegador manda o codec junto ("audio/webm;codecs=opus") ao gravar áudio;
    // guardamos o tipo base, senão a extensão do arquivo sai errada
    const mimeType = file.mimetype.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    if (ACTIVE_CONTENT.test(mimeType)) throw new BadRequestException(`Tipo não permitido: ${mimeType}`);
    const key = this.storage.makeKey(user.tenantId, mimeType, file.originalname);
    await this.storage.put(key, file.buffer, mimeType);
    return { key, url: this.storage.signedUrl(key), mimeType, fileName: file.originalname, size: file.size };
  }

  /**
   * Serve o arquivo se a assinatura for válida. Sem JWT: <img>/<audio> não mandam header.
   *
   * Responde a **Range request**. Player de áudio e vídeo não baixa o arquivo inteiro: pede
   * um pedaço e espera `206 Partial Content`. Devolver sempre 200 com tudo faz o player
   * travar na primeira tentativa e só funcionar na segunda, quando o arquivo já está em
   * cache — era exatamente o sintoma de "clico para ouvir e não sai nada".
   */
  @Get('media/*path')
  @SkipThrottle()
  async serve(@Param('path') path: string | string[], @Query('exp') exp = '', @Query('sig') sig = '', @Query('dl') dl: string | undefined, @Headers('range') range = '', @Res() res: Response) {
    const key = 'media/' + (Array.isArray(path) ? path.join('/') : path);
    if (!this.storage.verify(key, exp, sig)) throw new UnauthorizedException('Link expirado ou inválido');
    const obj = await this.storage.get(key);

    res.setHeader('Content-Type', obj.mimeType);
    // arquivo RECEBIDO pode ser HTML/SVG (o cliente manda o que quiser): baixa em vez de abrir
    // `?dl=nome` (botão Baixar): o atributo `download` do <a> não vale entre domínios (app → api),
    // então quem força o download com o nome original é este cabeçalho
    if (typeof dl === 'string') res.setHeader('Content-Disposition', contentDisposition(dl));
    else if (ACTIVE_CONTENT.test(obj.mimeType.split(';')[0].trim().toLowerCase())) res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // anunciar o suporte importa: sem este cabeçalho o player nem tenta pedir pedaços
    res.setHeader('Accept-Ranges', 'bytes');

    const faixa = parseRange(range, obj.data.length);
    if (!faixa) return res.send(obj.data);
    if (faixa === 'invalid') {
      res.setHeader('Content-Range', `bytes */${obj.data.length}`);
      return res.status(416).end();
    }

    const { start, end } = faixa;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${obj.data.length}`);
    res.setHeader('Content-Length', String(end - start + 1));
    return res.end(obj.data.subarray(start, end + 1));
  }
}

/**
 * `attachment` com o nome do arquivo. `filename` em ASCII para navegador antigo e `filename*`
 * (RFC 5987) com o nome real em UTF-8. Caractere de controle, aspas e barras saem: o nome vem
 * da query, sem assinatura, e não pode quebrar o cabeçalho nem virar caminho.
 */
export function contentDisposition(name: string): string {
  const limpo = name.replace(/[\u0000-\u001f\u007f"\\/]/g, '').trim().slice(0, 200) || 'arquivo';
  const ascii = limpo.normalize('NFD').replace(/[^\x20-\x7e]/g, '') || 'arquivo';
  const utf8 = encodeURIComponent(limpo).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * `bytes=início-fim` → faixa concreta. `null` = sem Range (serve tudo),
 * `'invalid'` = fora do arquivo (o HTTP manda responder 416).
 *
 * Só a forma simples de faixa única: é o que player de mídia usa. Múltiplas faixas
 * existem na norma e nenhum player as pede para áudio e vídeo.
 */
export function parseRange(header: string, total: number): { start: number; end: number } | 'invalid' | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!m || total === 0) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;

  // "bytes=-500" = os últimos 500 bytes
  const start = a === '' ? Math.max(0, total - Number(b)) : Number(a);
  const end = a === '' ? total - 1 : b === '' ? total - 1 : Math.min(Number(b), total - 1);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) return 'invalid';
  return { start, end };
}
