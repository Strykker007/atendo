import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SYSTEM_PROFILES } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PermissionsService } from '../auth/permissions.service';
import { provisionedTags, type TemplateContent, type TemplateSettings } from './tenant-template';

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
  /** configurações de atendimento do modelo (encerramento com/sem venda, assinatura, nomes dos resultados) */
  settings?: boolean;
}

export interface RolloutTenantResult {
  tenantId: string;
  name: string;
  profiles: { created: string[]; updated: string[] };
  closeReasons: { created: string[]; updated: string[]; reactivated: string[]; deactivated: string[] };
  tags: { created: string[] };
  /** configurações que mudaram, em texto para a prévia ("Encerramento com venda: desligado") */
  settings: { changed: string[] };
}

const lower = (s: string) => s.trim().toLowerCase();
/**
 * Nome "de verdade" do motivo: sem emoji/símbolo no começo, sem acento, minúsculo. "💰 Achou caro"
 * e "Achou caro" são o mesmo motivo — tratar como dois desativava o antigo e levava o histórico
 * junto (o filtro e os relatórios ficavam no id velho).
 */
const core = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
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
    if (!profiles.length && !parts.closeReasons && !parts.tags && !parts.settings) throw new BadRequestException('Escolha o que aplicar.');
    if (parts.settings && !content.settings) throw new BadRequestException('O modelo não tem configurações de atendimento — nada para aplicar.');

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
        settings: { changed: [] },
      };
      // um cliente por transação: falha num não deixa o outro pela metade
      await this.prisma.$transaction(async (tx) => {
        if (profiles.length) await this.applyProfiles(tx, t.id, profiles, r, dryRun);
        if (parts.closeReasons) await this.applyCloseReasons(tx, t.id, motivos, !!parts.replaceCloseReasons, r, dryRun);
        if (parts.tags) await this.applyTags(tx, t.id, tags, r, dryRun);
        if (parts.settings && content.settings) await this.applySettings(tx, t.id, content.settings, r, dryRun);
      });
      out.push(r);
    }

    if (!dryRun) {
      if (profiles.length) this.permissions.invalidate();
      this.log.log(`modelo aplicado em ${out.length} cliente(s): ${JSON.stringify({ profiles: parts.profiles, closeReasons: parts.closeReasons, replace: parts.replaceCloseReasons, tags: parts.tags, settings: parts.settings })}`);
    }
    return out;
  }

  private async applyProfiles(tx: Prisma.TransactionClient, tenantId: string, profiles: TemplateContent['profiles'], r: RolloutTenantResult, dryRun: boolean) {
    const existentes = await tx.accessProfile.findMany({ where: { tenantId }, select: { id: true, name: true, permissions: true, isSystem: true, systemRole: true } });
    for (const p of profiles) {
      if (p.name === ADMIN) continue;
      const atual = p.systemRole ? existentes.find((e) => e.systemRole === p.systemRole) : existentes.find((e) => e.name === p.name);
      if (!atual) {
        // Gerente/Atendente que o cliente ainda não materializou nascem como perfil padrão já ajustado
        const system = !!p.systemRole || SYSTEM_PROFILES.some((s) => s.name === p.name);
        const systemRole = p.systemRole ?? SYSTEM_PROFILES.find((s) => s.name === p.name)?.role;
        if (!dryRun) await tx.accessProfile.create({ data: { tenantId, name: p.name, description: p.description ?? null, permissions: p.permissions, isSystem: system, systemRole, customized: system } });
        r.profiles.created.push(p.name);
        continue;
      }
      const igual = atual.permissions.length === p.permissions.length && p.permissions.every((x) => atual.permissions.includes(x));
      if (igual) continue;
      // perfil padrão passa a `customized`: senão o alinhamento ao catálogo desfaria a matriz
      if (!dryRun) await tx.accessProfile.update({ where: { id: atual.id }, data: { name: p.systemRole ? p.name : atual.name, permissions: p.permissions, ...(atual.isSystem && { customized: true }) } });
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
      // mesmo nome primeiro; senão o mesmo motivo com outro emoji/acento ("Achou caro" → "💰 Achou caro").
      // Entre vários, o ativo; entre ativos, o que já tem histórico vem de qualquer jeito pelo id
      const candidatos = (f: (e: (typeof existentes)[number]) => boolean) => existentes.filter((e) => !usados.has(e.id) && f(e)).sort((a, b) => Number(b.isActive) - Number(a.isActive))[0];
      const atual = candidatos((e) => lower(e.name) === lower(m.name)) ?? candidatos((e) => core(e.name) === core(m.name));
      if (atual?.ignoreInReports) continue; // motivo interno com o mesmo nome: não vira motivo de venda
      if (!atual) {
        if (!dryRun) await tx.closeReason.create({ data: { tenantId, name: m.name, outcome: m.outcome, position, ...(m.color && { color: m.color }) } });
        r.closeReasons.created.push(m.name);
        continue;
      }
      usados.add(atual.id);
      const mudouCor = !!m.color && atual.color.toLowerCase() !== m.color;
      // renomeia mantendo o id (o histórico vai junto); só não renomeia se outro motivo já usa o nome
      const renomear = atual.name !== m.name && !existentes.some((e) => e.id !== atual.id && lower(e.name) === lower(m.name));
      const rotulo = renomear ? `${atual.name} → ${m.name}` : atual.name;
      if (!atual.isActive) r.closeReasons.reactivated.push(rotulo);
      else if (renomear || atual.outcome !== m.outcome || mudouCor) r.closeReasons.updated.push(rotulo);
      if (!dryRun) await tx.closeReason.update({ where: { id: atual.id }, data: { isActive: true, outcome: m.outcome, position, ...(renomear && { name: m.name }), ...(m.color && { color: m.color }) } });
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

  /** Só o que o modelo define; o resto do `tenant_settings` do cliente fica como está. */
  private async applySettings(tx: Prisma.TransactionClient, tenantId: string, settings: TemplateSettings, r: RolloutTenantResult, dryRun: boolean) {
    const atual = await tx.tenantSettings.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
    const sim = (v: boolean) => (v ? 'ligado' : 'desligado');
    const data: TemplateSettings = {};
    if (settings.salesEnabled !== undefined && settings.salesEnabled !== atual.salesEnabled) { data.salesEnabled = settings.salesEnabled; r.settings.changed.push(`Encerramento com venda: ${sim(settings.salesEnabled)}`); }
    if (settings.requireSignature !== undefined && settings.requireSignature !== atual.requireSignature) { data.requireSignature = settings.requireSignature; r.settings.changed.push(`Assinatura obrigatória: ${sim(settings.requireSignature)}`); }
    if (settings.wonLabel && settings.wonLabel !== atual.wonLabel) { data.wonLabel = settings.wonLabel; r.settings.changed.push(`Resultado positivo: “${settings.wonLabel}”`); }
    if (settings.lostLabel && settings.lostLabel !== atual.lostLabel) { data.lostLabel = settings.lostLabel; r.settings.changed.push(`Resultado negativo: “${settings.lostLabel}”`); }
    if (!dryRun && Object.keys(data).length) await tx.tenantSettings.update({ where: { tenantId }, data });
  }
}
