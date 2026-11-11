import { describe, expect, it } from 'vitest';
import { parseTemplateContent, provisionedProfiles, templateAccess } from '../src/modules/tenants/tenant-template';

const base = { profiles: [], quickReplies: [], flows: [] };

describe('modelo de perfil: departamentos e acesso padrão (docs/20-modelos-de-perfil.md)', () => {
  it('departamentos com hierarquia pelo nome; pai inexistente ou ciclo vai para o topo', () => {
    const c = parseTemplateContent({
      ...base,
      departments: [
        { name: 'Administração', color: '#112233' },
        { name: 'Portaria', parent: 'administração' },
        { name: 'portaria' },
        { name: 'RH', parent: 'Inexistente' },
        { name: 'A', parent: 'B' },
        { name: 'B', parent: 'A' },
      ],
    });
    expect(c.departments).toEqual([
      { name: 'Administração', color: '#112233' },
      { name: 'Portaria', parent: 'Administração' },
      { name: 'RH' },
      { name: 'A' },
      { name: 'B', parent: 'A' },
    ]);
  });

  it('acesso do perfil só com departamentos do modelo; vai para o perfil do cliente', () => {
    const c = parseTemplateContent({
      ...base,
      departments: [{ name: 'Portaria' }],
      profiles: [{ name: 'Porteiro', permissions: [], access: { departments: ['portaria', 'Fantasma'] } }],
    });
    expect(c.profiles[0].access).toEqual({ departments: ['Portaria'] });
    const porteiro = provisionedProfiles(c).find((p) => p.name === 'Porteiro')!;
    expect(templateAccess(porteiro.access, new Map([['portaria', 'dep-1']]))).toEqual({ allNumbers: true, numberIds: [], defaultNumberIds: [], departmentIds: ['dep-1'], receiveAll: true, receiveNumberIds: [] });
  });

  it('configurações de redistribuição e saiu do plantão, com faixa', () => {
    expect(parseTemplateContent({ ...base, settings: { releaseAwayEnabled: true, releaseAwayMinutes: 45, autoReassignWaiting: true } }).settings).toEqual({ releaseAwayEnabled: true, releaseAwayMinutes: 45, autoReassignWaiting: true });
    expect(() => parseTemplateContent({ ...base, settings: { releaseAwayMinutes: 2 } })).toThrow(/5 a 240/);
  });
});
