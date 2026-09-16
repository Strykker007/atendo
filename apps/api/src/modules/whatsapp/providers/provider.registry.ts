import { Injectable } from '@nestjs/common';
import type { WhatsAppProvider as ProviderKind } from '@prisma/client';
import { MetaProvider } from './meta.provider';
import { EvolutionProvider } from './evolution.provider';
import type { WhatsAppProvider } from './provider.interface';

/** Resolve o adapter em runtime pelo campo `provider` do número. Sem restart, sem deploy. */
@Injectable()
export class ProviderRegistry {
  private readonly providers: Record<ProviderKind, WhatsAppProvider>;

  constructor(meta: MetaProvider, evolution: EvolutionProvider) {
    this.providers = { meta, evolution };
  }

  get(kind: ProviderKind): WhatsAppProvider {
    const p = this.providers[kind];
    if (!p) throw new Error(`Provider desconhecido: ${kind}`);
    return p;
  }
}
