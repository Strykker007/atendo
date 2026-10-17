import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
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
/** Dono do sistema logado como ele mesmo: recebe o status dos números de todos os clientes (monitor). */
const OWNERS_ROOM = 'owners';

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
export class ConversationsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer() server?: Server;
  private redis?: Redis;
  private emitter?: Emitter;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string;
      const payload = await this.jwt.verifyAsync<{ sub: string; tenantId: string; role: string; impersonatorId?: string }>(token, { secret: env.JWT_ACCESS_SECRET });
      // presença (monitor do dono): quem está com o painel aberto. O dono "entrando como" não conta
      client.data = { userId: payload.sub, tenantId: payload.tenantId ?? null, owner: isOwner(payload) };
      if (payload.tenantId) await client.join(`tenant:${payload.tenantId}`);
      if (payload.role === 'super_admin' && !payload.impersonatorId) await client.join(OWNERS_ROOM);
      // sala dos clientes logados: avisos globais do sistema. O dono é quem escreve o aviso —
      // não recebe de volta, nem quando está "entrando como" um cliente.
      if (!isOwner(payload)) await client.join(GLOBAL_ROOM);
      this.presenceChanged(client);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.presenceChanged(client);
  }

  /** Alguém do cliente abriu/fechou o painel: o monitor do dono recarrega a presença. */
  private presenceChanged(client: Socket) {
    const d = client.data as { tenantId?: string | null; owner?: boolean } | undefined;
    if (d?.tenantId && !d.owner) this.to(OWNERS_ROOM).emit('tenant_presence', { tenantId: d.tenantId });
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  /**
   * Usuários com o painel aberto agora, por cliente (sockets de todas as réplicas, via adapter
   * Redis). No worker não há servidor: volta vazio.
   */
  async presence(): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (!this.server) return out;
    for (const s of await this.server.fetchSockets()) {
      const d = s.data as { userId?: string; tenantId?: string | null; owner?: boolean } | undefined;
      if (!d?.tenantId || d.owner || !d.userId) continue;
      const set = out.get(d.tenantId) ?? new Set<string>();
      set.add(d.userId);
      out.set(d.tenantId, set);
    }
    return out;
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
    // monitor do dono: só o status (o QR é do cliente)
    this.to(OWNERS_ROOM).emit('tenant_number', { tenantId, id: number.id, status: number.status });
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
  /** Orçamentos da conversa mudaram (comprovante chegou pela página pública, pago): o painel recarrega. */
  emitBudgets(tenantId: string, conversationId: string, paid?: { total: number; contactName: string }) {
    this.room(tenantId).emit('budgets', { conversationId, ...(paid && { paid }) });
  }
  /** Conversa excluída: o painel tira da lista e fecha se estiver aberta. */
  emitConversationDeleted(tenantId: string, conversationId: string) {
    this.room(tenantId).emit('conversation_deleted', { conversationId });
  }
  emitMessagesCleared(tenantId: string, conversationId: string) {
    this.room(tenantId).emit('messages_cleared', { conversationId });
  }
  /** Colunas do Kanban mudaram (ordem, tag virou/deixou de ser etapa, renomeada, excluída). */
  emitKanban(tenantId: string) {
    this.room(tenantId).emit('kanban', {});
  }
  /**
   * Transmissão mudou (lote enviado, pausou, terminou). `alert` = parou sozinha (3 falhas
   * seguidas…): o painel avisa quem estiver com ele aberto, em qualquer tela.
   */
  emitCampaign(tenantId: string, event: { id: string; status: string; name?: string; alert?: string }) {
    this.room(tenantId).emit('campaign', event);
  }
}
