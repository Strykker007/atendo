import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { CryptoService } from './crypto/crypto.service';
import { RedisService } from './redis/redis.service';
import { StorageService } from './storage/storage.service';

@Global()
@Module({
  providers: [PrismaService, CryptoService, RedisService, StorageService],
  exports: [PrismaService, CryptoService, RedisService, StorageService],
})
export class CoreModule {}
