import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { Emitter } from '@socket.io/redis-emitter';
import Redis from 'ioredis';
import type { Conversation, WhatsAppNumber } from '@prisma/client';
// type-only: o service importa este gateway em tempo de execução, então um import de valor aqui fecharia o ciclo
import type { PresentedMessage } from './conversations.service';
import type { TypingEvent } from '@atendo/shared';
import { env } from '../../config/env';

/**
 * Cada tenant tem uma "sala". Eventos: message, conversation, number, appointment, kanban, typing.
 *
 * O worker (`worker.ts`) não tem servidor Socket.IO — sem isto, todo evento emitido por um job
 * que caiu lá (mensagem recebida, status do envio) sumia em silêncio. Nesse caso publicamos
 * direto no Redis; o `RedisIoAdapter` da API entrega aos sockets da sala.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: env.WEB_ORIGIN, credentials: true } })
export class ConversationsGateway implements OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() server?: Server;
  private redis?: Redis;
  private emitter?: Emitter;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string;
      const payload = await this.jwt.verifyAsync<{ tenantId: string }>(token, { secret: env.JWT_ACCESS_SECRET });
      await client.join(`tenant:${payload.tenantId}`);
    } catch {
      client.disconnect(true);
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  private room(tenantId: string) {
    const room = `tenant:${tenantId}`;
    if (this.server) return this.server.to(room);
    if (!this.emitter) {
      this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
      this.emitter = new Emitter(this.redis);
    }
    return this.emitter.to(room);
  }

  emitMessage(tenantId: string, message: PresentedMessage) {
    this.room(tenantId).emit('message', message);
  }
  emitConversation(tenantId: string, conversation: Conversation) {
    this.room(tenantId).emit('conversation', conversation);
  }
  emitNumber(tenantId: string, number: Pick<WhatsAppNumber, 'id' | 'status'> & { qrCode?: string }) {
    this.room(tenantId).emit('number', number);
  }
  emitAppointment(tenantId: string, appointmentId: string) {
    this.room(tenantId).emit('appointment', { id: appointmentId });
  }
  /** Contato digitando/gravando. Efêmero: o painel esconde sozinho se o "parou" não chegar. */
  emitTyping(tenantId: string, event: TypingEvent) {
    this.room(tenantId).emit('typing', event);
  }
  /** Colunas do Kanban mudaram (ordem, tag virou/deixou de ser etapa, renomeada, excluída). */
  emitKanban(tenantId: string) {
    this.room(tenantId).emit('kanban', {});
  }
}
