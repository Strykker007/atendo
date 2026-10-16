import type { HttpOutcome } from './http-request';
import { CONTACT_FIELD_LABEL, type HttpNode, type ContactField } from '@atendo/shared';
import type { PrismaService } from '../../common/prisma/prisma.service';

/** Destinos livres são identificados pelo rótulo, como o catálogo da ficha. */
export async function saveFlowContactField(prisma: PrismaService, tenantId: string, conversationId: string, field: ContactField, value: string) {
  const conv = await prisma.conversation.findFirstOrThrow({ where: { id: conversationId, tenantId }, select: { contactId: true } });
  if (Object.hasOwn(CONTACT_FIELD_LABEL, field)) {
    await prisma.contact.update({ where: { id: conv.contactId, tenantId }, data: { [field]: value.slice(0, 1000), ...(field === 'name' && { nameSource: 'manual' as const }) } });
    return;
  }
  if (!field.startsWith('attribute:')) throw new Error('Campo da ficha inválido.');
  const label = field.slice(10);
  const source = await prisma.contactAttribute.findFirst({ where: { tenantId, label } });
  if (!source) throw new Error('Campo da ficha não existe nesta empresa.');
  const current = await prisma.contactAttribute.findFirst({ where: { tenantId, contactId: conv.contactId, label } });
  if (current) await prisma.contactAttribute.update({ where: { id: current.id, tenantId }, data: { value: value.slice(0, 1000), type: 'text' } });
  else await prisma.contactAttribute.create({ data: { tenantId, contactId: conv.contactId, label, type: 'text', value: value.slice(0, 1000) } });
}

/** O teste da requisição nunca chama esta gravação; só a execução real bem-sucedida. */
export async function saveHttpContactMappings(prisma: PrismaService, tenantId: string, conversationId: string, data: HttpNode['data'], outcome: HttpOutcome) {
  if (!outcome.ok) return;
  for (const mapping of data.mappings ?? []) {
    if (mapping.contactField && mapping.varName && !outcome.missing.includes(mapping.path)) {
      await saveFlowContactField(prisma, tenantId, conversationId, mapping.contactField, outcome.vars[mapping.varName] ?? '');
    }
  }
}
