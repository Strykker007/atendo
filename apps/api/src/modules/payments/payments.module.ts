import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Logger, Module, NotFoundException, Put, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { env } from '../../config/env';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { BillingModule } from '../billing/billing.module';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';
import { UsageService } from '../billing/usage.service';

const ASAAS_URL = { production: 'https://api.asaas.com/v3', sandbox: 'https://api-sandbox.asaas.com/v3' } as const;
/** Eventos que dão baixa: RECEIVED = Pix caiu; CONFIRMED = cartão/boleto confirmado (por garantia). */
export const ASAAS_PAID_EVENTS = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'] as const;

/**
 * Cliente HTTP do Asaas com a chave **da empresa** (não a do sistema, que é `billing/asaas.service.ts`).
 * Erro 4xx do Asaas vem em português e diz o que corrigir (CPF inválido, chave errada…): repassa.
 */
export class AsaasAccount {
  constructor(private readonly apiKey: string, private readonly sandbox: boolean) {}

  async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.sandbox ? ASAAS_URL.sandbox : ASAAS_URL.production}${path}`, {
      method,
      headers: { access_token: this.apiKey, 'Content-Type': 'application/json', 'User-Agent': 'atendo' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      if (res.status === 401) throw new BadRequestException('Chave de API do Asaas inválida ou de outro ambiente (produção × sandbox).');
      const msg = (json?.errors as { description: string }[] | undefined)?.map((e) => e.description).join(' ') || `Asaas respondeu ${res.status}`;
      if (res.status >= 400 && res.status < 500) throw new BadRequestException(msg);
      throw new ServiceUnavailableException(msg);
    }
    return json as T;
  }

  /** Cliente do Asaas pelo CPF/CNPJ (reaproveita se já existe na conta). */
  async customerId(cpfCnpj: string, name: string) {
    const found = await this.request<{ data: { id: string }[] }>('GET', `/customers?cpfCnpj=${cpfCnpj}&limit=1`);
    if (found.data?.[0]) return found.data[0].id;
    // sem notificação: quem fala com o cliente é a farmácia, não e-mail/SMS do Asaas
    const c = await this.request<{ id: string }>('POST', '/customers', { name, cpfCnpj, notificationDisabled: true });
    return c.id;
  }

  /** Cobrança Pix com o valor exato + QR. `externalReference` = id do orçamento. */
  async pixCharge(input: { customer: string; value: number; dueDate: string; description: string; externalReference: string }) {
    const p = await this.request<{ id: string }>('POST', '/payments', { ...input, billingType: 'PIX' });
    const qr = await this.request<{ encodedImage: string; payload: string }>('GET', `/payments/${p.id}/pixQrCode`);
    return { id: p.id, payload: qr.payload, qrImage: qr.encodedImage };
  }
}

type Credentials = { apiKey: string };

/**
 * Conta de recebimento da empresa (docs/orcamentos.md#pix-automático). Conectar valida a chave,
 * lê o nome da conta e cadastra o webhook nela — a empresa não configura nada no painel do Asaas.
 */
@Injectable()
export class PaymentGatewayService {
  private readonly log = new Logger(PaymentGatewayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly usage: UsageService,
  ) {}

  /** Conta pronta para cobrar: plano com o recurso + gateway conectado. `null` = Pix automático indisponível. */
  async accountFor(tenantId: string): Promise<AsaasAccount | null> {
    const [plan, g] = await Promise.all([this.usage.limits(tenantId), this.prisma.paymentGateway.findUnique({ where: { tenantId } })]);
    if (!g || !plan?.limits.features?.includes('pix_payments')) return null;
    return new AsaasAccount(this.crypto.decryptJson<Credentials>(g.credentials).apiKey, g.sandbox);
  }

  async status(tenantId: string) {
    const [plan, g] = await Promise.all([this.usage.limits(tenantId), this.prisma.paymentGateway.findUnique({ where: { tenantId } })]);
    return {
      feature: !!plan?.limits.features?.includes('pix_payments'),
      connected: !!g,
      ...(g && { provider: g.provider, sandbox: g.sandbox, accountName: g.accountName, connectedAt: g.createdAt }),
    };
  }

  async connect(tenantId: string, apiKey: string, sandbox: boolean) {
    const account = new AsaasAccount(apiKey.trim(), sandbox);
    // valida a chave antes de gravar qualquer coisa
    const info = await account.request<{ name?: string; companyName?: string; email?: string }>('GET', '/myAccount/commercialInfo');
    const atual = await this.prisma.paymentGateway.findUnique({ where: { tenantId } });
    if (atual) await this.dropWebhook(atual).catch(() => undefined);

    const webhookToken = randomBytes(24).toString('hex');
    const gatewayId = atual?.id ?? randomUUID();
    const admin = await this.prisma.user.findFirst({ where: { tenantId, role: 'tenant_admin', isActive: true }, select: { email: true }, orderBy: { createdAt: 'asc' } });
    const wh = await account.request<{ id: string }>('POST', '/webhooks', {
      name: 'Atendo — Pix do orçamento',
      url: `${env.API_PUBLIC_URL}/webhooks/pix/asaas/${gatewayId}`,
      // e-mail que o Asaas avisa se o webhook começar a falhar
      email: info.email || admin?.email,
      enabled: true,
      interrupted: false,
      authToken: webhookToken,
      sendType: 'SEQUENTIALLY',
      events: [...ASAAS_PAID_EVENTS],
    });

    const data = {
      provider: 'asaas',
      credentials: this.crypto.encryptJson({ apiKey: apiKey.trim() } satisfies Credentials),
      sandbox,
      webhookToken,
      webhookId: wh.id,
      accountName: info.companyName || info.name || null,
    };
    await this.prisma.paymentGateway.upsert({ where: { tenantId }, create: { id: gatewayId, tenantId, ...data }, update: data });
    this.log.log(`tenant ${tenantId}: Asaas conectado (${sandbox ? 'sandbox' : 'produção'})`);
    return this.status(tenantId);
  }

  async disconnect(tenantId: string) {
    const g = await this.prisma.paymentGateway.findUnique({ where: { tenantId } });
    if (!g) throw new NotFoundException('Nenhuma conta conectada');
    // tira o webhook da conta dela; se a chave já foi revogada, segue mesmo assim
    await this.dropWebhook(g).catch((e) => this.log.warn(`não removeu o webhook do Asaas: ${e instanceof Error ? e.message : e}`));
    await this.prisma.paymentGateway.delete({ where: { tenantId } });
    return { ok: true };
  }

  private async dropWebhook(g: { credentials: string; sandbox: boolean; webhookId: string | null }) {
    if (!g.webhookId) return;
    await new AsaasAccount(this.crypto.decryptJson<Credentials>(g.credentials).apiKey, g.sandbox).request('DELETE', `/webhooks/${g.webhookId}`);
  }
}

class ConnectDto {
  @IsString() @MinLength(20) @MaxLength(400) apiKey: string;
  @IsOptional() @IsBoolean() sandbox?: boolean;
}

/** Status é de todos (o modal do orçamento precisa saber se oferece Pix automático); conectar: `settings.manage` + plano. */
@Controller('tenants/me/payment-gateway')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PermissionsGuard, FeatureGuard)
class PaymentGatewayController {
  constructor(private readonly gateway: PaymentGatewayService) {}

  @Get()
  status(@CurrentUser() u: AuthUser) {
    return this.gateway.status(u.tenantId);
  }

  @Put()
  @RequirePermission('settings.manage')
  @RequireFeature('pix_payments')
  connect(@CurrentUser() u: AuthUser, @Body() dto: ConnectDto) {
    return this.gateway.connect(u.tenantId, dto.apiKey, !!dto.sandbox);
  }

  @Delete()
  @RequirePermission('settings.manage')
  disconnect(@CurrentUser() u: AuthUser) {
    return this.gateway.disconnect(u.tenantId);
  }
}

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [PaymentGatewayController],
  providers: [PaymentGatewayService],
  exports: [PaymentGatewayService],
})
export class PaymentsModule {}
