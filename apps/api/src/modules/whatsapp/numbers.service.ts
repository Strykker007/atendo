import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { WhatsAppProvider as ProviderKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ProviderRegistry } from './providers/provider.registry';
import type { NumberContext, OutboundReaction } from './providers/provider.interface';
import type { MetaNumberConfig } from './providers/meta.provider';
import type { EvolutionNumberConfig } from './providers/evolution.provider';

@Injectable()
export class NumbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly registry: ProviderRegistry,
  ) {}

  /** última assinatura de presença por número+contato: abrir a mesma conversa várias vezes não repete a chamada */
  private readonly presenceAt = new Map<string, number>();

  /**
   * Assina o "digitando…" do contato no provider. Chamado ao abrir a conversa no painel.
   * Nunca lança: é enfeite, não pode atrapalhar quem está atendendo.
   */
  async subscribePresence(numberId: string, phone: string) {
    const key = `${numberId}:${phone}`;
    if (Date.now() - (this.presenceAt.get(key) ?? 0) < 120_000) return;
    this.presenceAt.set(key, Date.now());
    try {
      const ctx = await this.context(numberId);
      await this.registry.get(ctx.provider).subscribePresence?.(ctx, phone);
    } catch {
      this.presenceAt.delete(key); // tenta de novo na próxima abertura
    }
  }

  /** Reação do atendente a uma mensagem. Lança se o provider recusar — quem chama não grava nada. */
  async react(numberId: string, reaction: OutboundReaction) {
    const ctx = await this.context(numberId);
    await this.registry.get(ctx.provider).react(ctx, reaction);
  }

  async context(numberId: string): Promise<NumberContext & { provider: ProviderKind }> {
    const n = await this.prisma.whatsAppNumber.findUnique({ where: { id: numberId } });
    if (!n) throw new NotFoundException('Número não encontrado');
    return {
      numberId: n.id,
      tenantId: n.tenantId,
      phone: n.phone,
      externalId: n.externalId,
      provider: n.provider,
      config: this.crypto.decryptJson(n.providerConfig),
    };
  }

  /**
   * Troca de provider: um único ponto, uma única transação.
   * Histórico de conversas não é tocado (chave é o telefone do contato).
   */
  async switchProvider(numberId: string, provider: ProviderKind, config: MetaNumberConfig | EvolutionNumberConfig) {
    const current = await this.context(numberId);
    if (current.provider !== provider) {
      await this.registry.get(current.provider).disconnect(current).catch(() => undefined);
    }

    const externalId =
      provider === 'meta' ? (config as MetaNumberConfig).phoneNumberId : (config as EvolutionNumberConfig).instanceName;
    if (!externalId) throw new BadRequestException('Configuração do provider incompleta');

    const updated = await this.prisma.whatsAppNumber.update({
      where: { id: numberId },
      data: { provider, externalId, providerConfig: this.crypto.encryptJson(config), status: 'disconnected' },
    });

    const ctx = await this.context(updated.id);
    const result = await this.registry.get(provider).connect(ctx);
    await this.prisma.whatsAppNumber.update({ where: { id: numberId }, data: { status: result.status } });
    return { ...updated, providerConfig: undefined, status: result.status, qrCode: result.qrCode };
  }

  async remove(numberId: string) {
    const ctx = await this.context(numberId);
    const provider = this.registry.get(ctx.provider);
    await (provider.destroy ? provider.destroy(ctx) : provider.disconnect(ctx)).catch(() => undefined);
    await this.prisma.whatsAppNumber.delete({ where: { id: numberId } });
  }

  async findByExternal(provider: ProviderKind, externalId: string) {
    return this.prisma.whatsAppNumber.findUnique({ where: { provider_externalId: { provider, externalId } } });
  }
}
