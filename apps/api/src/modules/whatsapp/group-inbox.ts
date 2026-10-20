import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsageService } from '../billing/usage.service';

/** Quanto a lista de um número vale em memória. Cobre a outra réplica da API e o plano trocado. */
const TTL_MS = 60_000;
const NONE: ReadonlySet<string> = new Set();

/**
 * Grupos que passam pelo filtro do webhook (docs/grupos.md#grupos-nas-conversas): os marcados
 * "Mostrar nas conversas", de número não excluído, de conta com o recurso `groups_inbox`.
 *
 * Fica em memória por instância e só vai ao banco quando chega evento de grupo com a lista
 * vencida — grupo movimentado manda centenas de mensagens por minuto, e consultar a cada uma
 * era justamente o que o filtro evitava.
 */
@Injectable()
export class GroupInboxRegistry {
  private readonly cache = new Map<string, { at: number; jids: Promise<ReadonlySet<string>> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}

  allowed(instance: string): Promise<ReadonlySet<string>> {
    if (!instance) return Promise.resolve(NONE);
    const hit = this.cache.get(instance);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.jids;
    // guarda a promessa: a rajada de um grupo movimentado espera a mesma consulta
    const jids = this.load(instance).catch(() => NONE);
    this.cache.set(instance, { at: Date.now(), jids });
    return jids;
  }

  /** Marcação mudou nesta réplica: vale na próxima mensagem (a outra réplica segue o TTL). */
  invalidate(instance: string) {
    this.cache.delete(instance);
  }

  private async load(instance: string): Promise<ReadonlySet<string>> {
    const n = await this.prisma.whatsAppNumber.findUnique({ where: { provider_externalId: { provider: 'evolution', externalId: instance } }, select: { id: true, tenantId: true, deletedAt: true } });
    if (!n || n.deletedAt) return NONE;
    const plan = await this.usage.limits(n.tenantId);
    if (!plan?.limits.features?.includes('groups_inbox')) return NONE;
    const rows = await this.prisma.whatsAppGroup.findMany({ where: { numberId: n.id, inbox: true }, select: { jid: true } });
    return new Set(rows.map((g) => g.jid));
  }
}
