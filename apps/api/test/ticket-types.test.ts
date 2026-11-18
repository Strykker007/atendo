import { describe, expect, it } from 'vitest';
import { TICKET_PRIORITIES, TICKET_TYPE_MAX_FIELDS, TICKET_TYPE_PRESETS, checkTicketValues, cleanTicketFields, ticketFieldKey } from '@atendo/shared';

describe('cleanTicketFields', () => {
  it('gera chave sem acento a partir do rótulo e mantém a chave existente', () => {
    expect(ticketFieldKey('Nº do apartamento')).toBe('n_do_apartamento');
    const f = cleanTicketFields([{ label: 'Unidade' }, { key: 'bloco', label: 'Bloco / torre' }]);
    expect(f.map((x) => x.key)).toEqual(['unidade', 'bloco']);
  });
  it('chave repetida ganha sufixo; sem rótulo some; select sem opção some', () => {
    const f = cleanTicketFields([{ label: 'Área' }, { label: 'area' }, { label: '' }, { label: 'Tipo', type: 'select', options: [' ', ''] }]);
    expect(f.map((x) => x.key)).toEqual(['area', 'area_2']);
  });
  it('tipo desconhecido vira texto; opções sem repetição', () => {
    const [a, b] = cleanTicketFields([{ label: 'X', type: 'html' }, { label: 'Y', type: 'select', options: ['A', 'A', ' B '] }]);
    expect(a.type).toBe('text');
    expect(b.options).toEqual(['A', 'B']);
  });
});

describe('checkTicketValues', () => {
  const fields = cleanTicketFields([
    { label: 'Unidade', required: true },
    { label: 'Área', type: 'select', options: ['Salão de festas', 'Quadra'] },
    { label: 'Quantidade', type: 'number' },
    { label: 'Data', type: 'date' },
  ]);
  it('obrigatório vazio aparece em missing', () => {
    expect(checkTicketValues(fields, {}).missing).toEqual(['Unidade']);
  });
  it('select aceita sem acento/maiúscula e grava a opção cadastrada', () => {
    const r = checkTicketValues(fields, { unidade: '302', area: 'salao de FESTAS' });
    expect(r.values).toEqual({ unidade: '302', area: 'Salão de festas' });
    expect(r.invalid).toEqual([]);
  });
  it('fora da lista: guarda o texto e avisa', () => {
    const r = checkTicketValues(fields, { unidade: '1', area: 'Piscina' });
    expect(r.values.area).toBe('Piscina');
    expect(r.invalid).toEqual(['Área']);
  });
  it('número e data conferidos; campo desconhecido descartado', () => {
    const r = checkTicketValues(fields, { unidade: '1', quantidade: 'duas', data: '12/11', extra: 'x' });
    expect(r.invalid).toEqual(['Quantidade']);
    expect(r.values).not.toHaveProperty('extra');
  });
});

describe('modelos por nicho', () => {
  it('todos os modelos passam pela própria limpeza sem perder campo', () => {
    for (const p of TICKET_TYPE_PRESETS) for (const t of p.types) expect(cleanTicketFields(t.fields)).toHaveLength(t.fields.length);
  });

  // o import grava os campos como estão (applyPreset): precisam já sair limpos, com a mesma chave
  it('campos dos modelos já estão no formato final (limpar não muda nada)', () => {
    for (const p of TICKET_TYPE_PRESETS) for (const t of p.types) expect(cleanTicketFields(t.fields), `${p.niche} › ${t.name}`).toEqual(t.fields);
  });

  it('nicho único, nome de tipo único no nicho, cor #rrggbb, prioridade e prazo válidos', () => {
    expect(new Set(TICKET_TYPE_PRESETS.map((p) => p.niche)).size).toBe(TICKET_TYPE_PRESETS.length);
    for (const p of TICKET_TYPE_PRESETS) {
      expect(p.types.length, p.niche).toBeGreaterThan(0);
      expect(new Set(p.types.map((t) => t.name.toLowerCase())).size, p.niche).toBe(p.types.length);
      for (const t of p.types) {
        expect(t.color, `${p.niche} › ${t.name}`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(TICKET_PRIORITIES).toContain(t.priority);
        if (t.dueDays !== null) expect(Number.isInteger(t.dueDays) && t.dueDays > 0, `${p.niche} › ${t.name}`).toBe(true);
        expect(t.fields.length).toBeLessThanOrEqual(TICKET_TYPE_MAX_FIELDS);
        for (const f of t.fields) if (f.type === 'select') expect(f.options?.length, `${t.name} › ${f.label}`).toBeGreaterThan(0);
      }
    }
  });

  it('administradora e jurídico existem, com o campo que identifica o caso obrigatório', () => {
    const nicho = (n: string) => TICKET_TYPE_PRESETS.find((p) => p.niche === n)!;
    const adm = nicho('administradora');
    expect(adm.types.map((t) => t.name)).toEqual(['2ª via de boleto', 'Solicitação administrativa', 'Orçamento de prestador', 'Manutenção']);
    // toda demanda da administradora diz de qual condomínio é
    for (const t of adm.types) expect(t.fields.find((f) => f.key === 'condominio')?.required, t.name).toBe(true);
    const jur = nicho('juridico');
    expect(jur.types.map((t) => t.name)).toEqual(['Consulta inicial', 'Andamento de processo', 'Envio de documentos', 'Prazo / audiência']);
    expect(jur.types.find((t) => t.name === 'Andamento de processo')!.fields.find((f) => f.key === 'numero_do_processo')?.required).toBe(true);
    const prazo = jur.types.find((t) => t.name === 'Prazo / audiência')!;
    expect(prazo.priority).toBe('urgent');
    expect(prazo.fields.find((f) => f.key === 'data')).toMatchObject({ type: 'date', required: true });
  });

  it('campo select do modelo aceita a opção sem acento/maiúscula e recusa o que não está na lista', () => {
    const consulta = TICKET_TYPE_PRESETS.find((p) => p.niche === 'juridico')!.types[0];
    const ok = checkTicketValues(consulta.fields, { cliente: 'Maria', area: 'previdenciario', resumo_do_caso: 'aposentadoria' });
    expect(ok).toEqual({ values: { cliente: 'Maria', area: 'Previdenciário', resumo_do_caso: 'aposentadoria' }, missing: [], invalid: [] });
    const ruim = checkTicketValues(consulta.fields, { area: 'Marítimo' });
    expect(ruim.missing).toEqual(['Cliente', 'Resumo do caso']);
    expect(ruim.invalid).toEqual(['Área']);
  });
});
