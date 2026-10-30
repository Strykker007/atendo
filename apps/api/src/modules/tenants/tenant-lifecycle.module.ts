import { BadRequestException, Body, Controller, Injectable, Logger, Module, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { ShiftAccessService } from '../auth/shift-access.service';
import { BillingModule } from '../billing/billing.module';
import { StripeService } from '../billing/stripe.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ProviderRegistry } from '../whatsapp/providers/provider.registry';
import { NumbersService } from '../whatsapp/numbers.service';

class DeactivateDto {
  /** o dono confirmou: cancela também a assinatura no Asaas/Stripe */
  @IsOptional() @IsBoolean() cancelBilling?: boolean;
}

/**
 * Desativar cliente de verdade (docs/desativar-cliente.md): parado, ele não ocupa servidor nem
 * gera custo. Corta o acesso da equipe (donos do sistema continuam entrando), exclui as instâncias
 * QR, para fluxos e campanhas; o recebimento e o envio são barrados em `InboundProcessor` e
 * `UsageService.canSend`. Conversas, contatos e histórico ficam.
 */
@Injectable()
export class TenantLifecycleService {
  private readonly log = new Logger(TenantLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shift: ShiftAccessService,
    private readonly stripe: StripeService,
    private readonly numbers: NumbersService,
    private readonly registry: ProviderRegistry,
  ) {}

  async deactivate(tenantId: string, opts: { cancelBilling?: boolean } = {}) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, isActive: true } });
    if (!t) throw new NotFoundException('Cliente não encontrado');
    const agora = new Date();
    if (t.isActive) await this.prisma.tenant.update({ where: { id: tenantId }, data: { isActive: false, deactivatedAt: agora } });

    // equipe: sessões caem agora (o access token também). Donos do sistema seguem entrando
    const equipe = await this.prisma.user.findMany({ where: { tenantId, isSystemOwner: false, role: { not: 'super_admin' } }, select: { id: true } });
    const ids = equipe.map((u) => u.id);
    if (ids.length) {
      await this.prisma.refreshToken.updateMany({ where: { userId: { in: ids }, revokedAt: null }, data: { revokedAt: agora } });
      await this.shift.cutSessions(ids);
    }

    // números: marca ANTES de sair do provider (o 401 do logout não pode virar "removido pelo
    // WhatsApp"); QR = instância excluída, sem memória nem socket. Meta só para de ser processada
    const nums = await this.prisma.whatsAppNumber.findMany({ where: { tenantId, deletedAt: null, isActive: true }, select: { id: true } });
    for (const n of nums) {
      await this.prisma.whatsAppNumber.update({ where: { id: n.id }, data: { isActive: false, suspendedAt: agora, status: 'disconnected' } });
      const ctx = await this.numbers.context(n.id);
      const p = this.registry.get(ctx.provider);
      if (p.destroy) await p.destroy(ctx).catch((err) => this.log.warn(`número ${n.id}: instância não excluída (${err?.message ?? err})`));
    }

    // nada roda sozinho para quem está parado
    const [runs, campanhas] = await Promise.all([
      this.prisma.flowRun.updateMany({ where: { tenantId, status: { in: ['running', 'waiting', 'paused'] } }, data: { status: 'stopped', endedAt: agora, error: 'cliente desativado', pausedFrom: null } }),
      this.prisma.campaign.updateMany({ where: { tenantId, status: { in: ['scheduled', 'running'] } }, data: { status: 'paused' } }),
    ]);

    let billing: { canceled: boolean; error?: string } = { canceled: false };
    if (opts.cancelBilling) {
      billing = await this.stripe.cancelForDeactivation(tenantId).catch((err) => ({ canceled: false, error: err instanceof Error ? err.message : String(err) }));
    }
    this.log.log(`cliente ${t.name} (${tenantId}) desativado: ${ids.length} sessões, ${nums.length} números, ${runs.count} fluxos, ${campanhas.count} campanhas${billing.canceled ? ', assinatura cancelada' : ''}`);
    return { ok: true, users: ids.length, numbers: nums.length, flowRuns: runs.count, campaigns: campanhas.count, billing };
  }

  /** Volta a valer: equipe entra de novo; números voltam desconectados (QR: ler de novo em Números). */
  async reactivate(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { isActive: true } });
    if (!t) throw new NotFoundException('Cliente não encontrado');
    if (t.isActive) throw new BadRequestException('Este cliente já está ativo.');
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { isActive: true, deactivatedAt: null } });
    const nums = await this.prisma.whatsAppNumber.updateMany({ where: { tenantId, deletedAt: null, suspendedAt: { not: null } }, data: { isActive: true, suspendedAt: null, status: 'disconnected' } });
    return { ok: true, numbers: nums.count };
  }
}

/** Só o dono do sistema. Reativar não refaz a cobrança: atribua o plano em Clientes, se cancelou. */
@Controller('tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class TenantLifecycleController {
  constructor(private readonly lifecycle: TenantLifecycleService) {}

  @Post(':id/deactivate') @NoTenantOk()
  deactivate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeactivateDto) { return this.lifecycle.deactivate(id, dto); }

  @Post(':id/reactivate') @NoTenantOk()
  reactivate(@Param('id', ParseUUIDPipe) id: string) { return this.lifecycle.reactivate(id); }
}

@Module({
  imports: [AuthModule, BillingModule, WhatsAppModule],
  controllers: [TenantLifecycleController],
  providers: [TenantLifecycleService],
})
export class TenantLifecycleModule {}
