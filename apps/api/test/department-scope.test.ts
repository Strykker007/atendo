import { describe, expect, it } from 'vitest';
import { canSeeDepartment, departmentRestricted, departmentWhere, type DeptScoped } from '../src/modules/auth/department-scope';

const u = (departmentIds?: string[], opts: { role?: string; viewAll?: boolean } = {}): DeptScoped => ({
  role: opts.role ?? 'agent',
  permissions: opts.viewAll ? ['conversations.view_all'] : [],
  departmentIds,
});

describe('quem é restringido por departamento', () => {
  it.each([[undefined], [[]]])('sem departamento vê tudo (%s) — ligar a funcionalidade não tranca ninguém', (ids) => {
    expect(departmentRestricted(u(ids))).toBe(false);
    expect(departmentWhere(u(ids))).toBeUndefined();
  });

  it('quem vê a equipe toda e o dono do sistema não são restringidos', () => {
    expect(departmentRestricted(u(['d1'], { viewAll: true }))).toBe(false);
    expect(departmentRestricted(u(['d1'], { role: 'super_admin' }))).toBe(false);
  });

  it('atendente de um departamento vê o dele e as sem departamento', () => {
    const a = u(['d1']);
    expect(departmentRestricted(a)).toBe(true);
    expect(canSeeDepartment(a, 'd1')).toBe(true);
    expect(canSeeDepartment(a, null)).toBe(true);
    expect(canSeeDepartment(a, 'd2')).toBe(false);
    expect(departmentWhere(a)).toEqual({ OR: [{ departmentId: null }, { departmentId: { in: ['d1'] } }] });
  });
});

describe('filtro da tela', () => {
  it('pedir um departamento que não enxerga devolve lista vazia, nunca "sem filtro"', () => {
    expect(departmentWhere(u(['d1']), 'd2')).toEqual({ departmentId: '-' });
  });
  it('pedido permitido e "sem departamento"', () => {
    expect(departmentWhere(u(['d1']), 'd1')).toEqual({ departmentId: 'd1' });
    expect(departmentWhere(u(['d1']), 'none')).toEqual({ departmentId: null });
    expect(departmentWhere(u(), 'd9')).toEqual({ departmentId: 'd9' });
  });
});
