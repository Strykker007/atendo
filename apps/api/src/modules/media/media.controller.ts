import { BadRequestException, Controller, Get, Param, Post, Query, Res, UnauthorizedException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { StorageService } from '../../common/storage/storage.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { env } from '../../config/env';

const ALLOWED = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|aac|webm)|video\/(mp4|3gpp)|application\/pdf|application\/(msword|vnd\.openxmlformats-officedocument.*|vnd\.ms-excel))/;

@Controller()
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  /** Upload pelo atendente (composer). Devolve a chave + URL assinada para prévia. */
  @Post('uploads')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: env.MEDIA_MAX_MB * 1024 * 1024 } }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Arquivo ausente (campo "file")');
    if (!ALLOWED.test(file.mimetype)) throw new BadRequestException(`Tipo não permitido: ${file.mimetype}`);
    const key = this.storage.makeKey(user.tenantId, file.mimetype, file.originalname);
    await this.storage.put(key, file.buffer, file.mimetype);
    return { key, url: this.storage.signedUrl(key), mimeType: file.mimetype, fileName: file.originalname, size: file.size };
  }

  /** Serve o arquivo se a assinatura for válida. Sem JWT: <img>/<audio> não mandam header. */
  @Get('media/*path')
  @SkipThrottle()
  async serve(@Param('path') path: string | string[], @Query('exp') exp = '', @Query('sig') sig = '', @Res() res: Response) {
    const key = 'media/' + (Array.isArray(path) ? path.join('/') : path);
    if (!this.storage.verify(key, exp, sig)) throw new UnauthorizedException('Link expirado ou inválido');
    const obj = await this.storage.get(key);
    res.setHeader('Content-Type', obj.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(obj.data);
  }
}
