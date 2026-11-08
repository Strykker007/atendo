import { describe, expect, it } from 'vitest';
import { chunkText, dot, fold, fuse, keywordQuery, packVector, paragraphs, queryFromHistory, searchableOf, unpackVector, CHUNK_TARGET } from '../src/modules/ai/knowledge-text';
import { documentLines } from '../src/modules/ai/agent-prompt';

const REGIMENTO = `REGIMENTO INTERNO DO CONDOMÍNIO RESIDENCIAL MODELO

CAPÍTULO I
DAS DISPOSIÇÕES GERAIS
Art. 1º Este regimento regula o uso das áreas comuns e a convivência entre os mo-
radores do condomínio.
Art. 2º Todos os condôminos, inquilinos e visitantes devem cumprir este regimento.

12

CAPÍTULO II
DAS OBRAS E REFORMAS
Art. 3º Obras nas unidades só podem ser feitas de segunda a sexta, das 8h às 17h, e aos
sábados das 9h às 13h.
Parágrafo único. É proibido fazer obras aos domingos e feriados.
Art. 4º O morador deve avisar a administração com 48 horas de antecedência, informando:
I - o tipo de obra;
II - o nome do responsável técnico;
III - a duração prevista.

CAPÍTULO III
DO SALÃO DE FESTAS
Art. 5º A reserva do salão de festas é feita na portaria, com até 30 dias de antecedência.
Art. 6º O salão deve ser devolvido limpo até as 10h do dia seguinte.`;

describe('paragraphs', () => {
  it('junta linha quebrada no meio da frase e desfaz a hifenização', () => {
    const p = paragraphs(REGIMENTO);
    expect(p).toContain('Art. 1º Este regimento regula o uso das áreas comuns e a convivência entre os moradores do condomínio.');
  });
  it('não gruda artigo, parágrafo único nem item de lista na linha de cima', () => {
    const p = paragraphs(REGIMENTO);
    expect(p).toContain('Parágrafo único. É proibido fazer obras aos domingos e feriados.');
    expect(p).toContain('I - o tipo de obra;');
    expect(p.some((x) => x.startsWith('Art. 4º') && x.includes('informando:'))).toBe(true);
  });
  it('descarta número de página solto', () => {
    expect(paragraphs(REGIMENTO)).not.toContain('12');
  });
});

describe('chunkText', () => {
  it('cada trecho sabe em que capítulo está', () => {
    const chunks = chunkText(REGIMENTO.repeat(1));
    const obras = chunks.find((c) => c.text.includes('domingos'));
    expect(obras?.heading).toBe('CAPÍTULO II — DAS OBRAS E REFORMAS');
  });
  it('documento grande vira vários trechos sem passar do teto', () => {
    const grande = Array.from({ length: 60 }, (_, i) => `Art. ${i + 1} ${'O condômino deve respeitar as regras de convivência e o silêncio. '.repeat(6)}`).join('\n');
    const chunks = chunkText(grande);
    expect(chunks.length).toBeGreaterThan(10);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(2000);
    expect(chunks.map((c) => c.position)).toEqual(chunks.map((_, i) => i));
    // corta no começo de artigo: nenhum trecho começa no meio de um
    expect(chunks.every((c) => c.text.startsWith('Art.'))).toBe(true);
  });
  it('parágrafo gigante sem quebra é cortado por frase', () => {
    const chunks = chunkText('Frase comprida de teste sobre o condomínio. '.repeat(200));
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(2000);
    expect(chunks[0].text.length).toBeGreaterThan(CHUNK_TARGET * 0.5);
  });
  it('texto vazio não gera trecho', () => {
    expect(chunkText('  \n\n ')).toEqual([]);
  });
  it('searchableOf põe o capítulo junto do texto para a busca', () => {
    expect(searchableOf({ heading: 'CAPÍTULO III — DO SALÃO DE FESTAS', text: 'Art. 6º O salão deve ser devolvido limpo.' })).toMatch(/^CAPÍTULO III/);
  });
});

describe('keywordQuery', () => {
  it('tira acento, junta com OU e ignora palavras curtas', () => {
    expect(keywordQuery('Posso fazer OBRA no domingo?')).toBe('posso | fazer | obra | domingo');
    expect(fold('salão')).toBe('salao');
  });
  it('mantém número de artigo', () => {
    expect(keywordQuery('o que diz o art 12')).toBe('que | diz | art | 12');
  });
  it('nada do contato vira operador do tsquery', () => {
    const q = keywordQuery("obra' & !domingo | (feriado):* <-> x")!;
    expect(q).toMatch(/^[a-z0-9| ]+$/);
  });
  it('sem palavra útil = sem busca', () => {
    expect(keywordQuery('?? !! a o')).toBeNull();
  });
});

describe('vetores', () => {
  it('normaliza: produto escalar vira cosseno', () => {
    const a = unpackVector(packVector([3, 4]));
    expect(dot(a, a)).toBeCloseTo(1, 5);
    const b = unpackVector(packVector([4, 3]));
    expect(dot(a, b)).toBeCloseTo(24 / 25, 5);
  });
  it('tamanhos diferentes não se comparam', () => {
    expect(dot(unpackVector(packVector([1, 0])), unpackVector(packVector([1, 0, 0])))).toBe(-1);
  });
  it('lê Buffer desalinhado (como o Prisma entrega)', () => {
    const packed = packVector([1, 2, 3]);
    const shifted = Buffer.concat([Buffer.from([0]), packed]).subarray(1);
    expect(Array.from(unpackVector(shifted))).toEqual(Array.from(unpackVector(packed)));
  });
});

describe('fuse', () => {
  it('quem aparece nas duas buscas sobe', () => {
    const r = fuse(['a', 'b', 'c'], ['c', 'd']);
    expect(r[0]).toEqual({ id: 'c', via: ['keyword', 'semantic'] });
    expect(r.map((x) => x.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('só uma busca: mantém a ordem dela', () => {
    expect(fuse(['x', 'y'], []).map((r) => r.id)).toEqual(['x', 'y']);
  });
});

describe('queryFromHistory', () => {
  it('usa as duas últimas mensagens do contato, sem nota interna', () => {
    const q = queryFromHistory([
      { direction: 'in', text: 'oi' },
      { direction: 'in', text: 'posso fazer obra?' },
      { direction: 'out', text: 'Pode sim, em dias úteis.' },
      { direction: 'out', text: 'nota', internal: true },
      { direction: 'in', text: 'e no domingo?' },
    ]);
    expect(q).toBe('posso fazer obra?\ne no domingo?');
  });
});

describe('documentLines (prompt)', () => {
  it('agente sem documento: nada no prompt', () => {
    expect(documentLines(null)).toEqual([]);
  });
  it('nada encontrado: proíbe supor e manda para humano', () => {
    expect(documentLines([]).join('\n')).toMatch(/Não suponha/);
  });
  it('trechos entram com documento e capítulo', () => {
    const txt = documentLines([{ docId: 'd', docName: 'Regimento.pdf', position: 2, heading: 'CAPÍTULO II — DAS OBRAS', text: 'Art. 3º …', via: ['keyword'] }]).join('\n');
    expect(txt).toContain('--- Regimento.pdf · CAPÍTULO II — DAS OBRAS ---');
    expect(txt).toContain('Art. 3º …');
  });
});
