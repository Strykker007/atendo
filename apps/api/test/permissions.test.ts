import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, PERMISSION_GROUPS } from '@atendo/shared';
import { can, grantable, permissionsOf, sanitize, type Principal } from '../src/modules/auth/permissions';

const p = (role: Principal['role'], profilePermissions?: string[] | null): Principal => ({ role, profilePermissions });

describe('permissionsOf', () => {
  it('usa o papel quando o usuário ainda não tem perfil — ninguém perde acesso ao migrar', () => {
    expect(permissionsOf(p('agent'))).toEqual(DEFAULT_PERMISSIONS.agent);
    expect(permissionsOf(p('manager'))).toEqual(DEFAULT_PERMISSIONS.manager);
    expect(permissionsOf(p('tenant_admin')).sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('o perfil manda sobre o papel', () => {
    expect(permissionsOf(p('agent', ['flows.manage', 'reports.view']))).toEqual(['flows.manage', 'reports.view']);
    // um "atendente líder": papel de atendente, mas com acesso que o papel não dá
    expect(can(p('agent', ['team.manage']), 'team.manage')).toBe(true);
  });

  it('perfil vazio concede nada — não cai de volta no papel', () => {
    // voltar ao padrão do papel daria MAIS acesso do que o administrador marcou na tela,
    // que é exatamente o erro que um sistema de permissões não pode cometer
    expect(permissionsOf(p('manager', []))).toEqual([]);
    expect(can(p('manager', []), 'flows.manage')).toBe(false);
    expect(permissionsOf(p('manager', ['tags.manage']))).toEqual(['tags.manage']);
  });

  it('o dono do sistema tem TUDO, mesmo com um perfil restrito pendurado nele', () => {
    // vale aqui, não só nos guards: cada ponto que tivesse de lembrar do papel à parte
    // seria um candidato a esquecer
    expect([...permissionsOf(p('super_admin'))].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect([...permissionsOf(p('super_admin', ['tags.manage']))].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect([...permissionsOf(p('super_admin', []))].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('descarta o que não existe no catálogo', () => {
    expect(permissionsOf(p('agent', ['flows.manage', 'inventei.tudo']))).toEqual(['flows.manage']);
  });
});

describe('can', () => {
  it('o dono do sistema passa por qualquer checagem — é ele quem dá suporte', () => {
    expect(can(p('super_admin'), 'billing.manage')).toBe(true);
    expect(can(p('super_admin', []), 'numbers.manage')).toBe(true);
  });

  it('atendente padrão não mexe em cobrança, mas conecta números', () => {
    expect(can(p('agent'), 'billing.manage')).toBe(false);
    // desde agent_default_permissions o atendente reconecta o número sem depender do admin
    expect(can(p('agent'), 'numbers.manage')).toBe(true);
    // o padrão do atendente reproduz o acesso que ele já tinha antes dos perfis
    expect(can(p('agent'), 'quick_replies.manage')).toBe(true);
    expect(can(p('agent'), 'reports.view')).toBe(true);
    expect(can(p('agent'), 'conversations.view_all')).toBe(false);
  });

  it('gerente padrão não mexe em números nem em cobrança', () => {
    expect(can(p('manager'), 'numbers.manage')).toBe(false);
    expect(can(p('manager'), 'billing.manage')).toBe(false);
    expect(can(p('manager'), 'flows.manage')).toBe(true);
  });
});

describe('sanitize', () => {
  it('aceita só o que está no catálogo, sem repetir', () => {
    expect(sanitize(['tags.manage', 'tags.manage', 'nao.existe', 42, null])).toEqual(['tags.manage']);
  });
  it.each([[null], [undefined], ['texto'], [{}]])('o que não é lista vira lista vazia (%s)', (v) => {
    expect(sanitize(v)).toEqual([]);
  });
});

describe('grantable', () => {
  it('não deixa dar o que quem edita não tem — senão qualquer um se promove a dono da conta', () => {
    const gerente = p('manager');
    expect(grantable(gerente, ['flows.manage', 'billing.manage'])).toEqual(['flows.manage']);
  });

  it('administrador do cliente pode dar tudo que ele tem', () => {
    expect(grantable(p('tenant_admin'), ['billing.manage', 'numbers.manage'])).toEqual(['billing.manage', 'numbers.manage']);
  });

  it('o dono do sistema não é limitado', () => {
    expect(grantable(p('super_admin'), ['billing.manage'])).toEqual(['billing.manage']);
  });

  it('um perfil restrito não consegue ampliar a si mesmo', () => {
    const lider = p('agent', ['profiles.manage', 'tags.manage']);
    expect(grantable(lider, ['profiles.manage', 'numbers.manage', 'billing.manage'])).toEqual(['profiles.manage']);
  });
});

describe('catálogo', () => {
  it('todo grupo da tela cobre o catálogo inteiro, sem sobra nem repetição', () => {
    const agrupadas = PERMISSION_GROUPS.flatMap((g) => g.items);
    expect([...agrupadas].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(new Set(agrupadas).size).toBe(agrupadas.length);
  });

  it('todo papel padrão só cita permissões existentes', () => {
    for (const [role, perms] of Object.entries(DEFAULT_PERMISSIONS)) {
      expect(perms.filter((x) => !ALL_PERMISSIONS.includes(x)), role).toEqual([]);
    }
  });
});
