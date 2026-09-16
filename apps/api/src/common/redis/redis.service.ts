import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/env';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor() {
    super(env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  onModuleDestroy() {
    this.disconnect();
  }
}
