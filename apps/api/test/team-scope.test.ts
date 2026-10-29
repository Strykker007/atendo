import { describe, expect, it } from 'vitest';
import { creatorCompanyIds, isolatedNumbers, teamCompanyIds, teamWhere } from '../src/modules/auth/team-scope';

// administradora com dois condomínios (A e B) e a separação por empresa ligada
const gestorPredial = { role: 'manager', companyIsolation: true, companyRestricted: true, companyIds: ['A'] };
const gerenteContrato = { role: 'manager', companyIsolation: true, companyRestricted: true, companyIds: ['A', 'B'] };
const gerenteAdm = { role: 'manager', companyIsolation: true, companyRestricted: false };

describe('equipe por condomínio (team-scope)', () => {
  it('gestor predial vê só a equipe do condomínio dele', () => {
    expect(teamCompanyIds(gestorPredial)).toEqual(['A']);
    expect(teamWhere(gestorPredial)).toEqual({ companies: { some: { companyId: { in: ['A'] } } } });
  });

  it('gerente de contrato vê a equipe de todos os condomínios em que atua', () => {
    expect(teamCompanyIds(gerenteContrato)).toEqual(['A', 'B']);
  });

  it('sem vínculo, admin da conta e dono do sistema entrando como cliente veem a equipe toda', () => {
    expect(teamCompanyIds(gerenteAdm)).toBeNull();
    expect(teamWhere(gerenteAdm)).toEqual({});
    expect(teamCompanyIds({ ...gestorPredial, role: 'tenant_admin' })).toBeNull();
    expect(teamCompanyIds({ ...gestorPredial, role: 'super_admin' })).toBeNull();
    expect(teamCompanyIds({ ...gestorPredial, impersonatorId: 'dono' })).toBeNull();
  });

  it('vínculo sem empresa válida não abre a equipe toda', () => {
    expect(teamWhere({ role: 'agent', companyIsolation: true, companyRestricted: true })).toEqual({ companies: { some: { companyId: { in: [] } } } });
  });

  it('pessoa criada por quem é restrito nasce no condomínio selecionado, ou em todos os dele', () => {
    expect(creatorCompanyIds({ ...gerenteContrato, companyId: 'B' })).toEqual(['B']);
    expect(creatorCompanyIds({ ...gerenteContrato, companyId: null })).toEqual(['A', 'B']);
    // empresa selecionada fora do vínculo (header forjado) não vale
    expect(creatorCompanyIds({ ...gestorPredial, companyId: 'B' })).toEqual(['A']);
    expect(creatorCompanyIds({ ...gerenteAdm, companyId: 'A' })).toEqual([]);
  });

  it('separação desligada (padrão, ex.: farmácia com filiais): tudo como sempre foi', () => {
    const gerenteFilial = { ...gestorPredial, companyIsolation: false, numberIds: ['n-A'] };
    expect(teamCompanyIds(gerenteFilial)).toBeNull();
    expect(teamWhere(gerenteFilial)).toEqual({});
    expect(creatorCompanyIds({ ...gerenteFilial, companyId: 'A' })).toEqual([]);
    expect(isolatedNumbers(gerenteFilial)).toBeUndefined();
  });

  it('separação ligada: planilha e transmissões só nos números de quem pede', () => {
    expect(isolatedNumbers({ ...gestorPredial, numberIds: ['n-A'] })).toEqual({ in: ['n-A'] });
    expect(isolatedNumbers({ ...gerenteAdm, numberIds: [] })).toBeUndefined();
  });
});
