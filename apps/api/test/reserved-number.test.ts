import { describe, expect, it } from 'vitest';
import { PermissionsService } from '../src/modules/auth/permissions.service';
import { NO_NUMBER } from '../src/modules/auth/company-scope';

// Número reservado (docs/18-perfis-de-acesso.md#número-reservado): "sem marcação = todos" vira
// "todos os NÃO reservados" para quem não é admin da conta.

type Num = { id: string; reserved: boolean };

function fake(links: Record<string, string[]>, numbers: Num[], defaults: Record<string, string[]> = {}) {
  return {
    user: {
      findUnique: async ({ where }: any) => ({
        tenantId: 't1',
        primaryUserId: null,
        defaultNumberIds: defaults[where.id] ?? [],
        profile: null,
        numbers: (links[where.id] ?? []).map((numberId) => ({ numberId })),
        departments: [],
        companies: [],
      }),
      count: async () => 0,
    },
    whatsAppNumber: { findMany: async () => numbers.map((n) => ({ ...n })) },
  };
}

const NUMS: Num[] = [
  { id: 'portaria', reserved: false },
  { id: 'concierge', reserved: false },
  { id: 'gerencia', reserved: true },
];

describe('número reservado', () => {
  it('sem número reservado nada muda: sem marcação = todos (lista vazia)', async () => {
    const p = new PermissionsService(fake({}, NUMS.map((n) => ({ ...n, reserved: false }))) as never);
    expect((await p.scope({ id: 'porteiro', role: 'agent' })).numberIds).toEqual([]);
  });

  it('quem não tem marcação passa a operar só os não reservados', async () => {
    const p = new PermissionsService(fake({}, NUMS) as never);
    const s = await p.scope({ id: 'porteiro', role: 'agent' });
    expect(s.numberIds.sort()).toEqual(['concierge', 'portaria']);
    // a tela de Equipe continua mostrando "todos" (nada marcado)
    expect(s.linkedNumberIds).toEqual([]);
  });

  it('gerente sem marcação também não vê o reservado', async () => {
    const p = new PermissionsService(fake({}, NUMS) as never);
    expect((await p.scope({ id: 'gerente', role: 'manager' })).numberIds).not.toContain('gerencia');
  });

  it('quem está marcado no reservado vê', async () => {
    const p = new PermissionsService(fake({ gerente: ['gerencia', 'portaria'] }, NUMS) as never);
    expect((await p.scope({ id: 'gerente', role: 'manager' })).numberIds).toEqual(['gerencia', 'portaria']);
  });

  it('admin da conta sem marcação continua vendo todos', async () => {
    const p = new PermissionsService(fake({}, NUMS) as never);
    expect((await p.scope({ id: 'admin', role: 'tenant_admin' })).numberIds).toEqual([]);
  });

  it('todos reservados e sem marcação = nenhum (nunca "todos")', async () => {
    const p = new PermissionsService(fake({}, NUMS.map((n) => ({ ...n, reserved: true }))) as never);
    expect((await p.scope({ id: 'porteiro', role: 'agent' })).numberIds).toEqual([NO_NUMBER]);
  });

  it('número padrão: só os que a pessoa ainda opera', async () => {
    const p = new PermissionsService(fake({}, NUMS, { porteiro: ['portaria', 'gerencia'] }) as never);
    expect((await p.scope({ id: 'porteiro', role: 'agent' })).defaultNumberIds).toEqual(['portaria']);
  });
});
