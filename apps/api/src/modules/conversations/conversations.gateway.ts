import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import type { Conversation, Message, WhatsAppNumber } from '@prisma/client';
import { env } from '../../config/env';

/** Cada tenant tem uma "sala". Eventos: message, conversation, number. */
@Injectable()
@WebSocketGateway({ cors: { origin: env.WEB_ORIGIN, credentials: true } })
export class ConversationsGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

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

  emitMessage(tenantId: string, message: Message) {
    this.server?.to(`tenant:${tenantId}`).emit('message', message);
  }
  emitConversation(tenantId: string, conversation: Conversation) {
    this.server?.to(`tenant:${tenantId}`).emit('conversation', conversation);
  }
  emitNumber(tenantId: string, number: Pick<WhatsAppNumber, 'id' | 'status'> & { qrCode?: string }) {
    this.server?.to(`tenant:${tenantId}`).emit('number', number);
  }
}
