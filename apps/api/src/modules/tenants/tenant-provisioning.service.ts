import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { SYSTEM_PROFILES, copyName, flowFromPortable, flowTagNames, flowToPortable, uniqueName, type FlowDefinition, type FlowNodeType, type FlowTrigger, type PortableFlow } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { assertOwnFlowMedia, validateDefinition } from '../flows/flow-validation';
import { toPortableReply } from '../quick-replies/portable';
import { provisionedProfiles, type TemplateContent } from './tenant-template';

const newId = (type: FlowNodeType) => `${type}-${randomUUID().slice(0, 6)}`;

/**
 * Monta o cliente novo a partir de um modelo de perfil (ou do padrão, sem modelo) e faz o
 * caminho inverso — tirar um modelo de um cliente que já está redondo.
 */
@Injectable()
export class TenantProvisioningService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fluxos do modelo passam pela mesma validação do editor. Roda na importação do modelo, para
   * o erro aparecer para quem subiu o arquivo — e não na hora de criar o cliente.
   */
  assertFlows(flows: PortableFlow[]) {
    const fakeTags = Object.fromEntries(flows.flatMap((p) => flowTagNames(p.definition)).map((n) => [n, n]));
    for (const p of flows) {
      try {
        validateDefinition(flowFromPortable(p, fakeTags, newId).definition);
      } catch (e) {
        throw new BadRequestException(`Fluxo "${p.name}": ${e instanceof Error ? e.message : 'inválido'}`);
      }
    }
  }

  /**
   * Perfis, respostas rápidas e fluxos do cliente recém-criado — dentro da transação da criação:
   * cliente sem os perfis (ou com metade das respostas) não pode existir.
   *
   * Fluxos nascem **desligados**: os números ainda não existem, e um robô respondendo cliente
   * de verdade antes de o admin revisar é pior do que um fluxo esperando ser ligado. Desligado
   * também não conta em `maxFlows`.
   */
  async provision(tx: Prisma.TransactionClient, tenantId: string, content: TemplateContent | null) {
    await tx.accessProfile.createMany({
      data: provisionedProfiles(content).map((p) => ({ tenantId, name: p.name, description: p.description || null, permissions: p.permissions, isSystem: p.isSystem, customized: p.customized })),
    });
    if (!content) return;

    const folders = new Map<string, { id: string; titles: string[]; next: number }>();
    for (const it of content.quickReplies) {
      let f = folders.get(it.folder);
      if (!f) {
        const nf = await tx.quickReplyFolder.create({ data: { tenantId, name: it.folder, position: folders.size } });
        f = { id: nf.id, titles: [], next: 0 };
        folders.set(it.folder, f);
      }
      const title = f.titles.includes(it.title) ? copyName(it.title, f.titles) : it.title;
      f.titles.push(title);
      await tx.quickReply.create({ data: { folderId: f.id, title, body: it.body, position: f.next++ } });
    }

    if (!content.flows.length) return;
    const tagNames = [...new Set(content.flows.flatMap((p) => flowTagNames(p.definition)))];
    if (tagNames.length) await tx.tag.createMany({ data: tagNames.map((name) => ({ tenantId, name })), skipDuplicates: true });
    const tags = await tx.tag.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const tagIdByName = Object.fromEntries(tags.map((t) => [t.name, t.id]));
    const taken: string[] = [];
    for (const p of content.flows) {
      const b = flowFromPortable(p, tagIdByName, newId);
      validateDefinition(b.definition);
      assertOwnFlowMedia(tenantId, b.definition);
      const name = uniqueName(b.name, taken);
      taken.push(name);
      await tx.flow.create({ data: { tenantId, name, description: b.description, isActive: false, trigger: b.trigger as object, definition: b.definition as object } });
    }
  }

  /**
   * Modelo a partir de um cliente existente: perfis que ele ajustou, respostas e fluxos.
   * Perfil padrão que o cliente nunca editou fica de fora — ele só repete o catálogo, e no
   * modelo congelaria a matriz de hoje.
   */
  async capture(tenantId: string): Promise<{ content: TemplateContent; warnings: string[] }> {
    const [profiles, replies, flows, tags, settings] = await Promise.all([
      this.prisma.accessProfile.findMany({ where: { tenantId }, orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] }),
      this.prisma.quickReply.findMany({ where: { folder: { tenantId } }, include: { folder: { select: { name: true } } }, orderBy: [{ folder: { position: 'asc' } }, { position: 'asc' }] }),
      this.prisma.flow.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
      this.prisma.tag.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { lossReasons: true } }),
    ]);
    const admin = SYSTEM_PROFILES.find((p) => p.role === 'tenant_admin')!.name;
    const warnings = new Set<string>();
    const tagNameById = Object.fromEntries(tags.map((t) => [t.id, t.name]));
    const flowNameById = Object.fromEntries(flows.map((f) => [f.id, f.name]));
    const qr = replies.map((r) => toPortableReply(r, r.folder.name));
    qr.forEach((o) => o.warnings.forEach((w) => warnings.add(w)));
    const portableFlows = flows.map((f) => {
      const out = flowToPortable({ name: f.name, description: f.description, trigger: f.trigger as unknown as FlowTrigger, definition: f.definition as unknown as FlowDefinition }, { tagNameById, flowNameById });
      out.warnings.forEach((w) => warnings.add(`${f.name}: ${w}`));
      return out.portable;
    });
    return {
      content: {
        profiles: profiles
          .filter((p) => p.name !== admin && (!p.isSystem || p.customized))
          .map((p) => ({ name: p.name, ...(p.description && { description: p.description }), permissions: p.permissions as TemplateContent['profiles'][number]['permissions'] })),
        quickReplies: qr.map((o) => o.portable),
        flows: portableFlows,
        ...(settings && { lossReasons: settings.lossReasons }),
      },
      warnings: [...warnings],
    };
  }

  /**
   * Cliente que nasceu de um modelo: membro novo entra no perfil padrão do papel dele. Sem
   * isto, a matriz do modelo só valeria para quem alguém lembrasse de vincular à mão — o papel
   * cairia no conjunto padrão do catálogo.
   */
  async linkRoleProfile(tenantId: string, userId: string, role: 'tenant_admin' | 'manager' | 'agent') {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { templateId: true } });
    if (!tenant?.templateId) return;
    const name = SYSTEM_PROFILES.find((p) => p.role === role)?.name;
    const profile = name && (await this.prisma.accessProfile.findFirst({ where: { tenantId, name, isSystem: true }, select: { id: true } }));
    if (profile) await this.prisma.user.update({ where: { id: userId }, data: { profileId: profile.id } });
  }
}
