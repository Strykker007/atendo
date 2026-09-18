import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { env } from '../config/env';

/**
 * Com mais de uma réplica da API, um evento emitido numa réplica precisa chegar aos sockets
 * conectados nas outras. O adapter Redis (pub/sub) faz isso. Com uma réplica só, é inofensivo.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterCtor?: ReturnType<typeof createAdapter>;

  async connect() {
    const pub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const sub = pub.duplicate();
    await Promise.all([pub.connect?.(), sub.connect?.()].filter(Boolean));
    this.adapterCtor = createAdapter(pub, sub);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterCtor) server.adapter(this.adapterCtor);
    return server;
  }
}
