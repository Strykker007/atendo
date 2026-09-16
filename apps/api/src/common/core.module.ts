import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { CryptoService } from './crypto/crypto.service';
import { RedisService } from './redis/redis.service';

@Global()
@Module({
  providers: [PrismaService, CryptoService, RedisService],
  exports: [PrismaService, CryptoService, RedisService],
})
export class CoreModule {}
