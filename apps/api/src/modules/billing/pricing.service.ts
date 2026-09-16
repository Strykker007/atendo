import { Injectable } from '@nestjs/common';
import { BillingCategory, WhatsAppProvider as ProviderKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Custo unitário do provider por país/categoria. `service` e `unofficial` = 0. */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async unitCost(provider: ProviderKind, category: BillingCategory, country = 'BR', at = new Date()) {
    if (category === 'service' || category === 'unofficial') return 0;
    const row = await this.prisma.providerPricing.findFirst({
      where: { provider, category, country, validFrom: { lte: at } },
      orderBy: { validFrom: 'desc' },
    });
    return row ? Number(row.unitPrice) : 0;
  }
}
