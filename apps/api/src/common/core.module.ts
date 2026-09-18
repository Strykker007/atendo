import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { CryptoService } from './crypto/crypto.service';
import { RedisService } from './redis/redis.service';
import { StorageService } from './storage/storage.service';
import { MailService } from './mail/mail.service';

@Global()
@Module({
  providers: [PrismaService, CryptoService, RedisService, StorageService, MailService],
  exports: [PrismaService, CryptoService, RedisService, StorageService, MailService],
})
export class CoreModule {}
