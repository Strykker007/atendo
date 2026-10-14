import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SYSTEM_PROFILES } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PermissionsService } from '../auth/permissions.service';
import { provisionedTags, type TemplateContent } from './tenant-template';

/** O que replicar do modelo. Cada parte é opcional — o dono escolhe só o que quer mexer. */
export interface RolloutParts {
  /** nomes dos perfis do modelo a aplicar ("Gerente", "Atendente", extras) */
  profiles?: string[];
  /** motivos de encerramento = tags do modelo marcadas Comprou / Não comprou */
  closeReasons?: boolean;
  /** com `closeReasons`: desativa os motivos do cliente que não estão no modelo (padrão idêntico) */
  replaceCloseReasons?: boolean;
  /** cria as tags do modelo que o cliente ainda não tem (não altera nem remove as dele) */
  tags?: boolean;
}

export interface RolloutTenantResult {
  tenantId: string;
  name: string;
  profiles: { created: string[]; updated: string[] };
  closeReasons: { created: string[]; updated: string[]; reactivated: string[]; deactivated: string[] };
  tags: { created: string[] };
}

const lower = (s: string) => s.trim().toLowerCase();
const ADMIN = SYSTEM_PROFILES.find((p) => p.role === 'tenant_admin')!.name;

/**
 * Replica partes de um modelo de perfil em clientes que **já existem** (docs/20-modelos-de-perfil.md
 * → Aplicar aos clientes). A criação do cliente só lê o modelo uma vez; isto é o caminho para
 * mudar o padrão de todo mundo depois.
 *
 * Regras de segurança:
 * - casa por nome (ignorando maiúsculas); nunca apaga nada — motivo fora do padrão é
 *   **desativado** (o histórico guarda id e nome), perfil e tag nunca são removidos;
 * - Administrador e motivos de atendimento interno (`ignoreInReports`) não são tocados;
 * - `dryRun` calcula exatamente o mesmo resultado sem gravar, para a prévia da tela.
 */
@Injectable()
export class TemplateRolloutService {
  private readonly log = new Logger(TemplateRolloutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async run(content: TemplateContent, parts: RolloutParts, tenantIds: string[] | undefined, dryRun: boolean): Promise<RolloutTenantResult[]> {
    const profiles = (parts.profiles ?? []).map((name) => {
      const p = content.profiles.find((x) => x.name === name);
      if (!p) throw new BadRequestException(`O perfil "${name}" não está no modelo.`);
      return p;
    });
    if (!profiles.length && !parts.closeReasons && !parts.tags) throw new BadRequestException('Escolha o que aplicar.');

    const modelo = provisionedTags(content);
    const motivos = modelo
      .filter((t) => t.showOnWon || t.showOnLost)
      .map((t) => ({ name: t.name, color: t.color, outcome: t.showOnWon && t.showOnLost ? 'both' : t.showOnWon ? 'won' : 'lost' }));
    if (parts.closeReasons && !motivos.length) throw new BadRequestException('O modelo não tem tags marcadas Comprou / Não comprou — nada para aplicar como motivo.');
    // mesmo critério da criação do cliente: tag de encerramento fora do Kanban vira só motivo
    const tags = modelo.filter((t) => t.isKanban || !(t.showOnWon || t.showOnLost));

    const tenants = await this.prisma.tenant.findMany({
      where: tenantIds ? { id: { in: tenantIds } } : { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const out: RolloutTenantResult[] = [];
    for (const t of tenants) {
      const r: RolloutTenantResult = {
        tenantId: t.id,
        name: t.name,
        profiles: { created: [], updated: [] },
        closeReasons: { created: [], updated: [], reactivated: [], deactivated: [] },
        tags: { created: [] },
      };
      // um cliente por transação: falha num não deixa o outro pela metade
      await this.prisma.$transaction(async (tx) => {
        if (profiles.length) await this.applyProfiles(tx, t.id, profiles, r, dryRun);
        if (parts.closeReasons) await this.applyCloseReasons(tx, t.id, motivos, !!parts.replaceCloseReasons, r, dryRun);
        if (parts.tags) await this.applyTags(tx, t.id, tags, r, dryRun);
      });
      out.push(r);
    }

    if (!dryRun) {
      if (profiles.length) this.permissions.invalidate();
      this.log.log(`modelo aplicado em ${out.length} cliente(s): ${JSON.stringify({ profiles: parts.profiles, closeReasons: parts.closeReasons, replace: parts.replaceCloseReasons, tags: parts.tags })}`);
    }
    return out;
  }

  private async applyProfiles(tx: Prisma.TransactionClient, tenantId: string, profiles: TemplateContent['profiles'], r: RolloutTenantResult, dryRun: boolean) {
    const existentes = await tx.accessProfile.findMany({ where: { tenantId }, select: { id: true, name: true, permissions: true, isSystem: true } });
    for (const p of profiles) {
      if (p.name === ADMIN) continue;
      const atual = existentes.find((e) => e.name === p.name);
      if (!atual) {
        // Gerente/Atendente que o cliente ainda não materializou nascem como perfil padrão já ajustado
        const system = SYSTEM_PROFILES.some((s) => s.name === p.name);
        if (!dryRun) await tx.accessProfile.create({ data: { tenantId, name: p.name, description: p.description ?? null, permissions: p.permissions, isSystem: system, customized: system } });
        r.profiles.created.push(p.name);
        continue;
      }
      const igual = atual.permissions.length === p.permissions.length && p.permissions.every((x) => atual.permissions.includes(x));
      if (igual) continue;
      // perfil padrão passa a `customized`: senão o alinhamento ao catálogo desfaria a matriz
      if (!dryRun) await tx.accessProfile.update({ where: { id: atual.id }, data: { permissions: p.permissions, ...(atual.isSystem && { customized: true }) } });
      r.profiles.updated.push(p.name);
    }
  }

  private async applyCloseReasons(
    tx: Prisma.TransactionClient,
    tenantId: string,
    motivos: { name: string; color?: string; outcome: string }[],
    replace: boolean,
    r: RolloutTenantResult,
    dryRun: boolean,
  ) {
    const existentes = await tx.closeReason.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
    const usados = new Set<string>();

    for (const [position, m] of motivos.entries()) {
      // ativo primeiro: com "Achou caro" ativo e "achou caro" desativado, mexe no que aparece
      const atual = existentes.filter((e) => lower(e.name) === lower(m.name)).sort((a, b) => Number(b.isActive) - Number(a.isActive))[0];
      if (atual?.ignoreInReports) continue; // motivo interno com o mesmo nome: não vira motivo de venda
      if (!atual) {
        if (!dryRun) await tx.closeReason.create({ data: { tenantId, name: m.name, outcome: m.outcome, position, ...(m.color && { color: m.color }) } });
        r.closeReasons.created.push(m.name);
        continue;
      }
      usados.add(atual.id);
      const mudouCor = !!m.color && atual.color.toLowerCase() !== m.color;
      if (!atual.isActive) r.closeReasons.reactivated.push(atual.name);
      else if (atual.outcome !== m.outcome || mudouCor) r.closeReasons.updated.push(atual.name);
      if (!dryRun) await tx.closeReason.update({ where: { id: atual.id }, data: { isActive: true, outcome: m.outcome, position, ...(m.color && { color: m.color }) } });
    }

    // os do cliente que não estão no padrão: desativados (substituir) ou mantidos depois dos do padrão
    let next = motivos.length;
    for (const e of existentes) {
      if (usados.has(e.id) || !e.isActive || e.ignoreInReports) continue;
      if (replace) {
        if (!dryRun) await tx.closeReason.update({ where: { id: e.id }, data: { isActive: false } });
        r.closeReasons.deactivated.push(e.name);
      } else if (!dryRun) {
        await tx.closeReason.update({ where: { id: e.id }, data: { position: next++ } });
      }
    }
  }

  private async applyTags(tx: Prisma.TransactionClient, tenantId: string, tags: ReturnType<typeof provisionedTags>, r: RolloutTenantResult, dryRun: boolean) {
    const existentes = await tx.tag.findMany({ where: { tenantId }, select: { name: true, position: true } });
    const nomes = new Set(existentes.map((e) => lower(e.name)));
    let position = existentes.reduce((m, e) => Math.max(m, e.position + 1), 0);
    const novas = tags.filter((t) => !nomes.has(lower(t.name)));
    if (!novas.length) return;
    if (!dryRun) {
      await tx.tag.createMany({
        data: novas.map((t) => ({ tenantId, name: t.name, position: position++, isKanban: !!t.isKanban, ...(t.color && { color: t.color }) })),
        skipDuplicates: true,
      });
    }
    r.tags.created.push(...novas.map((t) => t.name));
  }
}
