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
  return (await exemptMode(prisma, tenantId, phone)) !== 'none';
}

/**
 * Como a conversa deste telefone se comporta (docs/contatos-isentos.md):
 * - `none`: atendimento comum;
 * - `exempt`: isento (segue a fila, sem relatório);
 * - `free`: conversa livre — sempre aberta, sem dono, ninguém encerra (marcado na lista com "Conversa livre").
 * Número da própria conta é `exempt`.
 */
export async function exemptMode(prisma: PrismaService, tenantId: string, phone: string): Promise<'none' | 'exempt' | 'free'> {
  const d = normalizeExemptPhone(phone);
  if (!d) return 'none';
  const variants = phoneVariants(d);
  const [listed, own] = await Promise.all([
    prisma.ignoredContact.findMany({ where: { tenantId, phone: { in: variants } }, select: { freeChat: true } }),
    prisma.whatsAppNumber.findFirst({ where: { tenantId, deletedAt: null, phone: { in: variants } }, select: { id: true } }),
  ]);
  if (listed.some((l) => l.freeChat)) return 'free';
  return listed.length || own ? 'exempt' : 'none';
}
