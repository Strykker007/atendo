import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';

/** GET /health — usado pelo load balancer e pelo Docker healthcheck. */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    const started = Date.now();
    try {
      await Promise.all([this.prisma.$queryRaw`select 1`, this.redis.ping()]);
    } catch (err) {
      throw new ServiceUnavailableException({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return { ok: true, uptime: Math.round(process.uptime()), latencyMs: Date.now() - started, version: process.env.APP_VERSION ?? 'dev' };
  }
}
