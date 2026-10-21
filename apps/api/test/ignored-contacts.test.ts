import { describe, expect, it, vi } from 'vitest';
import { isTicketExempt, normalizeExemptPhone } from '../src/modules/ignored-contacts/ignored-contacts';
import type { PrismaService } from '../src/common/prisma/prisma.service';

describe('contatos isentos de ticket', () => {
  it('normaliza telefone digitado ou JID do provider', () => {
    expect(normalizeExemptPhone('+55 (11) 99999-8888')).toBe('5511999998888');
    expect(normalizeExemptPhone('551199998888@s.whatsapp.net')).toBe('551199998888');
    expect(normalizeExemptPhone('551199998888:12@s.whatsapp.net')).toBe('551199998888');
  });

  it('confere com e sem o nono dígito', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'x' });
    const prisma = { ignoredContact: { findFirst }, whatsAppNumber: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as PrismaService;
    expect(await isTicketExempt(prisma, 't1', '551199998888')).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({ where: { tenantId: 't1', phone: { in: ['551199998888', '5511999998888'] } }, select: { id: true } });
  });

  it('outro número da própria conta é isento sem cadastro (equipe falando entre os números)', async () => {
    const numero = vi.fn().mockResolvedValue({ id: 'n2' });
    const prisma = { ignoredContact: { findFirst: vi.fn().mockResolvedValue(null) }, whatsAppNumber: { findFirst: numero } } as unknown as PrismaService;
    expect(await isTicketExempt(prisma, 't1', '556196079474')).toBe(true);
    expect(numero).toHaveBeenCalledWith({ where: { tenantId: 't1', deletedAt: null, phone: { in: ['556196079474', '5561996079474'] } }, select: { id: true } });
  });

  it('nem na lista nem número da conta: não é isento', async () => {
    const prisma = { ignoredContact: { findFirst: vi.fn().mockResolvedValue(null) }, whatsAppNumber: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as PrismaService;
    expect(await isTicketExempt(prisma, 't1', '5511999998888')).toBe(false);
  });

  it('telefone vazio nunca é isento (nem consulta o banco)', async () => {
    const findFirst = vi.fn();
    const prisma = { ignoredContact: { findFirst } } as unknown as PrismaService;
    expect(await isTicketExempt(prisma, 't1', '')).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
