import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { CryptoService } from './crypto/crypto.service';
import { RedisService } from './redis/redis.service';
import { StorageService } from './storage/storage.service';
import { MailService } from './mail/mail.service';
import { InterpolationService } from './interpolation/interpolation.service';

@Global()
@Module({
  providers: [PrismaService, CryptoService, RedisService, StorageService, MailService, InterpolationService],
  exports: [PrismaService, CryptoService, RedisService, StorageService, MailService, InterpolationService],
})
export class CoreModule {}
