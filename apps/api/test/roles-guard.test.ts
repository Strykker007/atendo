import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../src/modules/auth/roles.guard';

/** Guard com as roles da rota fixas e o usuário da requisição. */
function canActivate(roles: string[] | undefined, user: Record<string, unknown> | undefined) {
  const guard = new RolesGuard({ getAllAndOverride: () => roles } as never);
  const ctx = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ user }) }) };
  return guard.canActivate(ctx as never);
}

describe('RolesGuard — donos do sistema (docs/donos-do-sistema.md)', () => {
  it('dono por marcação entra na rota de dono sem ter o papel', () => {
    expect(canActivate(['super_admin'], { role: 'agent', systemOwner: true })).toBe(true);
  });

  it('sem a marcação, o mesmo usuário é barrado', () => {
    expect(() => canActivate(['super_admin'], { role: 'agent', systemOwner: false })).toThrow(ForbiddenException);
    expect(() => canActivate(['super_admin'], { role: 'tenant_admin' })).toThrow(ForbiddenException);
  });

  it('a marcação não promove ninguém dentro do cliente: rota de admin continua exigindo o papel', () => {
    expect(() => canActivate(['tenant_admin'], { role: 'agent', systemOwner: true })).toThrow(ForbiddenException);
    expect(canActivate(['tenant_admin'], { role: 'tenant_admin', systemOwner: true })).toBe(true);
  });

  it('super_admin continua entrando pelo papel', () => {
    expect(canActivate(['super_admin'], { role: 'super_admin' })).toBe(true);
  });

  it('rota sem @Roles continua livre', () => {
    expect(canActivate(undefined, { role: 'agent' })).toBe(true);
  });
});

/**
 * A regra do guard só é segura porque nenhuma rota mistura `super_admin` com papel de cliente: numa
 * `@Roles('super_admin', 'tenant_admin')`, um atendente marcado como dono passaria como admin dentro
 * da própria empresa. Rota assim precisa de outro desenho (ou de mudar o guard) antes de existir.
 */
describe('@Roles nunca mistura super_admin com papel de cliente', () => {
  const arquivos = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.ts') ? [p] : [];
  });

  it('nenhum @Roles(...) com super_admin e tenant_admin/manager/agent juntos', () => {
    const mistos = arquivos(join(__dirname, '../src')).flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/@Roles\(([^)]*)\)/g)]
        .map((m) => m[1])
        .filter((args) => args.includes("'super_admin'") && /'(tenant_admin|manager|agent)'/.test(args))
        .map((args) => `${f}: @Roles(${args})`),
    );
    expect(mistos).toEqual([]);
  });
});
