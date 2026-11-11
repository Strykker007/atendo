import { describe, expect, it } from 'vitest';
import { departmentDescendants } from '../src/modules/auth/permissions.service';

// Administração > Portaria > Portaria noturna; Concierge solto
const arvore = new Map<string, string | null>([
  ['adm', null],
  ['portaria', 'adm'],
  ['noturna', 'portaria'],
  ['concierge', null],
]);

describe('alcance de departamento (docs/departamentos.md#hierarquia)', () => {
  it('quem está no topo alcança todos abaixo', () => {
    expect(departmentDescendants(arvore, ['adm']).sort()).toEqual(['adm', 'noturna', 'portaria']);
  });

  it('quem está embaixo não sobe', () => {
    expect(departmentDescendants(arvore, ['portaria']).sort()).toEqual(['noturna', 'portaria']);
    expect(departmentDescendants(arvore, ['noturna'])).toEqual(['noturna']);
  });

  it('vários departamentos somam os alcances', () => {
    expect(departmentDescendants(arvore, ['noturna', 'concierge']).sort()).toEqual(['concierge', 'noturna']);
  });

  it('ciclo gravado por engano não trava', () => {
    const ciclo = new Map<string, string | null>([['a', 'b'], ['b', 'a']]);
    expect(departmentDescendants(ciclo, ['a']).sort()).toEqual(['a', 'b']);
  });
});
