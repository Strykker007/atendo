import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { Emitter } from '@socket.io/redis-emitter';
import Redis from 'ioredis';
import type { Conversation, SystemNotice, WhatsAppNumber } from '@prisma/client';
// type-only: o service importa este gateway em tempo de execução, então um import de valor aqui fecharia o ciclo
import type { PresentedMessage } from './conversations.service';
import type { TypingEvent } from '@atendo/shared';
import { env, webOrigins } from '../../config/env';

const GLOBAL_ROOM = 'global';

/** Dono do sistema, logado como ele mesmo ou "entrando como" um cliente. */
export const isOwner = (u: { role: string; impersonatorId?: string }) => u.role === 'super_admin' || !!u.impersonatorId;

/**
 * Cada tenant tem uma "sala"; todos também entram na sala global (evento system_notice). Eventos: message, messages_cleared, conversation, number, appointment, kanban, typing.
 *
 * O worker (`worker.ts`) não tem servidor Socket.IO — sem isto, todo evento emitido por um job
 * que caiu lá (mensagem recebida, status do envio) sumia em silêncio. Nesse caso publicamos
 * direto no Redis; o `RedisIoAdapter` da API entrega aos sockets da sala.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: webOrigins, credentials: true } })
export class ConversationsGateway implements OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() server?: Server;
  private redis?: Redis;
  private emitter?: Emitter;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string;
      const payload = await this.jwt.verifyAsync<{ tenantId: string; role: string; impersonatorId?: string }>(token, { secret: env.JWT_ACCESS_SECRET });
      if (payload.tenantId) await client.join(`tenant:${payload.tenantId}`);
      // sala dos clientes logados: avisos globais do sistema. O dono é quem escreve o aviso —
      // não recebe de volta, nem quando está "entrando como" um cliente.
      if (!isOwner(payload)) await client.join(GLOBAL_ROOM);
    } catch {
      client.disconnect(true);
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  private room(tenantId: string) {
    return this.to(`tenant:${tenantId}`);
  }

  private to(room: string) {
    if (this.server) return this.server.to(room);
    if (!this.emitter) {
      this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
      this.emitter = new Emitter(this.redis);
    }
    return this.emitter.to(room);
  }

  /** Aviso do dono do sistema para todos os clientes conectados (popup no topo + sino). */
  emitSystemNotice(notice: SystemNotice) {
    this.to(GLOBAL_ROOM).emit('system_notice', notice);
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
  /**
   * Histórico da conversa limpo. Um evento só em vez de um `message` por mensagem apagada: o
   * painel recarrega a conversa (que já vem redigida pelo `present()`).
   */
  /** Agendadas da conversa mudaram (criou, cancelou, saiu, falhou): o painel recarrega. */
  emitScheduledMessages(tenantId: string, conversationId: string) {
    this.room(tenantId).emit('scheduled_messages', { conversationId });
  }
  emitMessagesCleared(tenantId: string, conversationId: string) {
    this.room(tenantId).emit('messages_cleared', { conversationId });
  }
  /** Colunas do Kanban mudaram (ordem, tag virou/deixou de ser etapa, renomeada, excluída). */
  emitKanban(tenantId: string) {
    this.room(tenantId).emit('kanban', {});
  }
}
