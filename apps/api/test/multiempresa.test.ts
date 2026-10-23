import { describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/modules/auth/auth.service';
import { PermissionsService } from '../src/modules/auth/permissions.service';
import { loginEmail } from '../src/modules/auth/login-email';
import { env } from '../src/config/env';

// Uma pessoa em várias empresas (docs/multiempresa.md): login principal + vínculos.

type Row = { id: string; tenantId: string | null; email: string | null; name: string; role: string; isActive: boolean; isSystemOwner: boolean; primaryUserId: string | null; createdAt: Date };

/** where do Prisma, só o que o AuthService/PermissionsService usam aqui */
function matches(r: Row, w: any): boolean {
  if (!w) return true;
  return Object.entries(w).every(([k, v]) => {
    if (k === 'OR') return (v as any[]).some((x) => matches(r, x));
    if (k === 'AND') return (v as any[]).every((x) => matches(r, x));
    return (r as any)[k] === v;
  });
}

function fakePrisma(rows: Row[]) {
  const tenants: Record<string, string> = { tA: 'Atendo', tS: 'Condomínio' };
  const pick = (r: Row) => ({ ...r, tenant: r.tenantId ? { id: r.tenantId, name: tenants[r.tenantId] } : null, profile: null, numbers: [], departments: [], companies: [] });
  const user = {
    findUnique: async ({ where }: any) => { const r = rows.find((x) => x.id === where.id); return r ? pick(r) : null; },
    findUniqueOrThrow: async ({ where }: any) => { const r = rows.find((x) => x.id === where.id); if (!r) throw new Error('não achou'); return pick(r); },
    findMany: async ({ where }: any) => rows.filter((r) => matches(r, where)).map(pick),
    count: async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
    update: async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id)!; Object.assign(r, data); return pick(r); },
  };
  return { user, refreshToken: { create: async () => ({}) } };
}

const at = (n: number) => new Date(2026, 9, 23, 0, n);
/** Tiago: login principal super_admin; vínculo na Atendo (dono lá) e no condomínio (síndico, admin comum) */
const pessoas = (): Row[] => [
  { id: 'tiago', tenantId: null, email: 'tiago@x.com', name: 'Tiago', role: 'super_admin', isActive: true, isSystemOwner: false, primaryUserId: null, createdAt: at(0) },
  { id: 'tiago-atendo', tenantId: 'tA', email: null, name: 'Tiago', role: 'tenant_admin', isActive: true, isSystemOwner: true, primaryUserId: 'tiago', createdAt: at(1) },
  { id: 'tiago-condo', tenantId: 'tS', email: null, name: 'Tiago', role: 'tenant_admin', isActive: true, isSystemOwner: false, primaryUserId: 'tiago', createdAt: at(2) },
  { id: 'outra', tenantId: 'tS', email: 'outra@x.com', name: 'Outra', role: 'agent', isActive: true, isSystemOwner: false, primaryUserId: null, createdAt: at(3) },
];

function auth(rows = pessoas()) {
  const prisma = fakePrisma(rows);
  const jwt = new JwtService();
  const shift = { sessionWindow: async () => ({ shiftEndsAt: null, lockedUntil: null }) };
  return { svc: new AuthService(prisma as never, jwt, {} as never, shift as never), jwt, rows, prisma };
}
const decode = (jwt: JwtService, token: string) => jwt.verify(token, { secret: env.JWT_ACCESS_SECRET });

describe('memberships: "Minhas empresas" do seletor', () => {
  it('lista o login principal e os vínculos ativos, marcando a sessão atual', async () => {
    const { svc } = auth();
    const m = await svc.memberships({ id: 'tiago-condo' });
    expect(m.map((x) => [x.userId, x.tenantName, x.systemOwner, x.current])).toEqual([
      ['tiago', null, true, false],
      ['tiago-atendo', 'Atendo', true, false],
      ['tiago-condo', 'Condomínio', false, true],
    ]);
  });

  it('vínculo desativado some da lista', async () => {
    const { svc, rows } = auth();
    rows.find((r) => r.id === 'tiago-condo')!.isActive = false;
    expect((await svc.memberships({ id: 'tiago' })).map((x) => x.userId)).toEqual(['tiago', 'tiago-atendo']);
  });

  it('entrando como cliente, lista as empresas do dono (nenhuma é a sessão atual)', async () => {
    const { svc } = auth();
    const m = await svc.memberships({ id: 'tiago', impersonatorId: 'tiago' });
    expect(m.every((x) => !x.current)).toBe(true);
    expect(m).toHaveLength(3);
  });
});

describe('switchTo: troca de empresa', () => {
  it('sessão nova como o vínculo: tenant e papel de lá, e-mail do login e pid da pessoa', async () => {
    const { svc, jwt } = auth();
    const r = await svc.switchTo({ id: 'tiago' }, 'tiago-condo', {});
    const p = decode(jwt, r.accessToken);
    expect(p).toMatchObject({ sub: 'tiago-condo', tenantId: 'tS', role: 'tenant_admin', email: 'tiago@x.com', pid: 'tiago', owner: true });
    expect(r.refreshToken).toBeTruthy();
  });

  it('volta do vínculo para o login principal (sem pid)', async () => {
    const { svc, jwt } = auth();
    const p = decode(jwt, (await svc.switchTo({ id: 'tiago-condo' }, 'tiago', {})).accessToken);
    expect(p.sub).toBe('tiago');
    expect(p.pid).toBeUndefined();
  });

  it('não entra em linha de outra pessoa', async () => {
    const { svc } = auth();
    await expect(svc.switchTo({ id: 'tiago' }, 'outra', {})).rejects.toThrow(/não está entre as suas/);
    await expect(svc.switchTo({ id: 'outra' }, 'tiago-condo', {})).rejects.toThrow(/não está entre as suas/);
  });

  it('vínculo desativado não entra', async () => {
    const { svc, rows } = auth();
    rows.find((r) => r.id === 'tiago-condo')!.isActive = false;
    await expect(svc.switchTo({ id: 'tiago' }, 'tiago-condo', {})).rejects.toThrow(/desativado/);
  });

  it('entrando como cliente, troca pela pessoa do dono', async () => {
    const { svc, jwt } = auth();
    const p = decode(jwt, (await svc.switchTo({ id: 'tiago', impersonatorId: 'tiago' }, 'tiago-atendo', {})).accessToken);
    expect(p.sub).toBe('tiago-atendo');
  });
});

describe('dono é a pessoa; o acesso amplo é da empresa', () => {
  it('no condomínio (vínculo sem marcação) a sessão continua de dono', async () => {
    const perms = new PermissionsService(fakePrisma(pessoas()) as never);
    expect((await perms.scope({ id: 'tiago-condo', role: 'tenant_admin' })).systemOwner).toBe(true);
  });

  it('quem não tem nenhuma linha dona não é dono', async () => {
    const perms = new PermissionsService(fakePrisma(pessoas()) as never);
    expect((await perms.scope({ id: 'outra', role: 'agent' })).systemOwner).toBe(false);
  });

  it('pessoa comum com vínculo: dono só se alguma linha for marcada', async () => {
    const rows = pessoas();
    rows.push({ id: 'outra-atendo', tenantId: 'tA', email: null, name: 'Outra', role: 'agent', isActive: true, isSystemOwner: false, primaryUserId: 'outra', createdAt: at(4) });
    const perms = new PermissionsService(fakePrisma(rows) as never);
    expect((await perms.scope({ id: 'outra-atendo', role: 'agent' })).systemOwner).toBe(false);
  });
});

describe('loginEmail', () => {
  it('o próprio e-mail ou, no vínculo, o do login principal', () => {
    expect(loginEmail({ email: 'a@x.com' })).toBe('a@x.com');
    expect(loginEmail({ email: null, primaryUser: { email: 'p@x.com' } })).toBe('p@x.com');
    expect(loginEmail({ email: null, primaryUser: null })).toBeNull();
  });
});
