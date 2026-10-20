import type { PrismaService } from '../../common/prisma/prisma.service';
import { phoneVariants } from '../conversations/phone-variants';

/** "+55 (11) 99999-8888", "5511999998888@s.whatsapp.net" → só os dígitos. */
export function normalizeExemptPhone(raw: string) {
  return raw.split('@')[0].split(':')[0].replace(/\D/g, '');
}

/**
 * O telefone está na lista de isentos do cliente? Confere com e sem o nono dígito: o WhatsApp
 * entrega muitos celulares antigos sem ele, e o admin cadastra digitando com (docs/contatos-isentos.md).
 *
 * Outro número da PRÓPRIA conta também é isento, sem precisar cadastrar: é a equipe falando
 * entre os números da loja. Sem isto o robô de um responderia o outro, que responderia de volta.
 */
export async function isTicketExempt(prisma: PrismaService, tenantId: string, phone: string) {
  const d = normalizeExemptPhone(phone);
  if (!d) return false;
  const variants = phoneVariants(d);
  const [listed, own] = await Promise.all([
    prisma.ignoredContact.findFirst({ where: { tenantId, phone: { in: variants } }, select: { id: true } }),
    prisma.whatsAppNumber.findFirst({ where: { tenantId, deletedAt: null, phone: { in: variants } }, select: { id: true } }),
  ]);
  return !!(listed || own);
}
