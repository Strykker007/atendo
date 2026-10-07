import { describe, expect, it } from 'vitest';
import { NO_NUMBER, effectiveNumberIds } from '../src/modules/auth/company-scope';

const companyNumbers = new Map([
  ['matriz', ['n1', 'n2']],
  ['filial', ['n3']],
  ['vazia', []],
]);

describe('effectiveNumberIds', () => {
  it('sem vínculo e sem empresa escolhida: não restringe', () => {
    expect(effectiveNumberIds({ userNumberIds: [], userCompanyIds: [], companyNumbers })).toEqual({ numberIds: [], companyId: null });
  });

  it('empresa escolhida vira os números dela', () => {
    expect(effectiveNumberIds({ userNumberIds: [], userCompanyIds: [], companyNumbers, activeCompanyId: 'filial' })).toEqual({ numberIds: ['n3'], companyId: 'filial' });
  });

  it('vínculo a empresas sem escolha: união das permitidas', () => {
    expect(effectiveNumberIds({ userNumberIds: [], userCompanyIds: ['matriz', 'filial'], companyNumbers }).numberIds.sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('empresa que a pessoa não opera é ignorada (não amplia o acesso)', () => {
    expect(effectiveNumberIds({ userNumberIds: [], userCompanyIds: ['filial'], companyNumbers, activeCompanyId: 'matriz' })).toEqual({ numberIds: ['n3'], companyId: null });
  });

  it('cruza com o vínculo direto a números', () => {
    expect(effectiveNumberIds({ userNumberIds: ['n2', 'n3'], userCompanyIds: [], companyNumbers, activeCompanyId: 'matriz' }).numberIds).toEqual(['n2']);
  });

  it('interseção vazia é "nenhum", nunca "todos"', () => {
    expect(effectiveNumberIds({ userNumberIds: [], userCompanyIds: [], companyNumbers, activeCompanyId: 'vazia' }).numberIds).toEqual([NO_NUMBER]);
    expect(effectiveNumberIds({ userNumberIds: ['n1'], userCompanyIds: ['filial'], companyNumbers }).numberIds).toEqual([NO_NUMBER]);
  });
});
