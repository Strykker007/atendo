import { describe, expect, it } from 'vitest';
import { ReportDefinition } from '../src/modules/reports/reports.module';

const valido = { metric: 'conversations', groupBy: 'day', from: '2026-09-01', to: '2026-09-30' };

describe('ReportDefinition — a DSL que protege o SQL dos relatórios', () => {
  it('aceita uma definição válida e aplica os padrões', () => {
    const d = ReportDefinition.parse(valido);
    expect(d.metric).toBe('conversations');
    expect(d.chart).toBe('bar');
    expect(d.filters).toEqual({});
    expect(d.from).toBeInstanceOf(Date);
  });

  it('recusa métrica e agrupamento fora da lista fechada', () => {
    expect(() => ReportDefinition.parse({ ...valido, metric: 'receita' })).toThrow();
    expect(() => ReportDefinition.parse({ ...valido, groupBy: 'cpf' })).toThrow();
  });

  it('recusa tentativa de injeção de SQL no agrupamento', () => {
    for (const groupBy of ["day; drop table conversations", "day' or '1'='1", 'c."tenantId"']) {
      expect(() => ReportDefinition.parse({ ...valido, groupBy })).toThrow();
    }
  });

  it('recusa filtros com id que não é uuid (vão para dentro da query)', () => {
    expect(() => ReportDefinition.parse({ ...valido, filters: { numberId: "1' or '1'='1" } })).toThrow();
    expect(() => ReportDefinition.parse({ ...valido, filters: { tagIds: ['não-é-uuid'] } })).toThrow();
  });

  it('aceita filtros válidos', () => {
    const d = ReportDefinition.parse({ ...valido, filters: { tagIds: ['0b7b2b3e-7f3e-4a1e-9c2a-8e6c1d0a5b11'], status: 'closed', origin: 'ad' } });
    expect(d.filters.status).toBe('closed');
    expect(d.filters.tagIds).toHaveLength(1);
  });

  it('recusa status e origem fora dos enums do banco', () => {
    expect(() => ReportDefinition.parse({ ...valido, filters: { status: 'arquivada' } })).toThrow();
    expect(() => ReportDefinition.parse({ ...valido, filters: { origin: 'tiktok' } })).toThrow();
  });

  it('recusa período ausente ou inválido', () => {
    expect(() => ReportDefinition.parse({ metric: 'conversations', groupBy: 'day' })).toThrow();
    expect(() => ReportDefinition.parse({ ...valido, from: 'ontem' })).toThrow();
  });

  it('recusa tipo de gráfico desconhecido', () => {
    expect(() => ReportDefinition.parse({ ...valido, chart: 'radar' })).toThrow();
  });
});
