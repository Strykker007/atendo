import { describe, expect, it } from 'vitest';
import { parseAccessTemplate, sanitizeAccessTemplate } from '../src/modules/tenants/access-template';

describe('acesso padrão do perfil (docs/18-perfis-de-acesso.md#acesso-padrão-do-perfil)', () => {
  it('sem modelo = null (perfil antigo não aplica nada)', () => {
    expect(parseAccessTemplate(null)).toBeNull();
    expect(parseAccessTemplate([])).toBeNull();
  });

  it('padrões: todos os números e recebe de todos', () => {
    expect(parseAccessTemplate({})).toEqual({ allNumbers: true, numberIds: [], defaultNumberIds: [], departmentIds: [], receiveAll: true, receiveNumberIds: [] });
  });

  it('corta ids de outro cliente ou apagados e mantém abre filtrado/recebe dentro do que vê', () => {
    const t = parseAccessTemplate({ allNumbers: false, numberIds: ['n1', 'x'], defaultNumberIds: ['n1', 'n2'], departmentIds: ['d1', 'dx'], receiveAll: false, receiveNumberIds: ['n1', 'n2'] })!;
    expect(sanitizeAccessTemplate(t, ['n1', 'n2'], ['d1'])).toEqual({ allNumbers: false, numberIds: ['n1'], defaultNumberIds: ['n1'], departmentIds: ['d1'], receiveAll: false, receiveNumberIds: ['n1'] });
  });

  it('com todos os números, a lista marcada é descartada', () => {
    const t = parseAccessTemplate({ allNumbers: true, numberIds: ['n1'], defaultNumberIds: ['n2'] })!;
    expect(sanitizeAccessTemplate(t, ['n1', 'n2'], [])).toMatchObject({ numberIds: [], defaultNumberIds: ['n2'] });
  });
});
