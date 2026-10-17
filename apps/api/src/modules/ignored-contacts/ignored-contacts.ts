import type { PrismaService } from '../../common/prisma/prisma.service';
import { phoneVariants } from '../conversations/phone-variants';

/** "+55 (11) 99999-8888", "5511999998888@s.whatsapp.net" → só os dígitos. */
export function normalizeExemptPhone(raw: string) {
  return raw.split('@')[0].split(':')[0].replace(/\D/g, '');
}

/**
 * O telefone está na lista de isentos do cliente? Confere com e sem o nono dígito: o WhatsApp
 * entrega muitos celulares antigos sem ele, e o admin cadastra digitando com (docs/contatos-isentos.md).
 */
export async function isTicketExempt(prisma: PrismaService, tenantId: string, phone: string) {
  const d = normalizeExemptPhone(phone);
  if (!d) return false;
  return !!(await prisma.ignoredContact.findFirst({ where: { tenantId, phone: { in: phoneVariants(d) } }, select: { id: true } }));
}
