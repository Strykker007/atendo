import { describe, expect, it } from 'vitest';
import { secureMediaMessage } from '@atendo/shared';

const LINK = 'https://painel.exemplo/f/Ab3dEf';

describe('secureMediaMessage', () => {
  it('frase padrão com nome e validade', () => {
    expect(secureMediaMessage(LINK, 24, 'Ana')).toBe(`Olá Ana, a imagem está disponível neste link (válido por 1 dia): ${LINK}`);
  });
  it('sem nome, some o espaço junto com a variável', () => {
    expect(secureMediaMessage(LINK, 1, null)).toBe(`Olá, a imagem está disponível neste link (válido por 1 hora): ${LINK}`);
  });
  it('usa a frase da empresa', () => {
    expect(secureMediaMessage(LINK, 72, 'Ana', 'Sua foto, {{primeiro_nome}}! Vale {{validade}}: {{link}}')).toBe(`Sua foto, Ana! Vale 3 dias: ${LINK}`);
  });
  it('frase sem {{link}} ainda leva o link no fim', () => {
    expect(secureMediaMessage(LINK, 24, 'Ana', 'Foto pronta')).toBe(`Foto pronta ${LINK}`);
  });
  it('frase vazia volta à padrão', () => {
    expect(secureMediaMessage(LINK, 4, 'Ana', '   ')).toContain('válido por 4 horas');
  });
});
