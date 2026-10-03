import { describe, expect, it } from 'vitest';
import { decidirEntrada, voltandoDepoisDeEncerrado } from '../src/modules/conversations/reopen';

describe('decidirEntrada', () => {
  it('pessoa nova neste número: cria conversa', () => {
    expect(decidirEntrada(null)).toEqual({ acao: 'criar' });
    expect(decidirEntrada(undefined)).toEqual({ acao: 'criar' });
  });

  it('atendimento em andamento: a mensagem entra na mesma conversa', () => {
    expect(decidirEntrada({ id: 'c1', status: 'waiting' })).toEqual({ acao: 'usar', id: 'c1' });
    expect(decidirEntrada({ id: 'c1', status: 'in_progress' })).toEqual({ acao: 'usar', id: 'c1' });
  });

  it('encerrada: reabre a MESMA conversa — nunca cria uma segunda para o mesmo contato', () => {
    expect(decidirEntrada({ id: 'c1', status: 'closed' })).toEqual({ acao: 'reabrir', id: 'c1' });
  });
});

describe('voltandoDepoisDeEncerrado', () => {
  it('reabertura é sempre um retorno', () => {
    expect(voltandoDepoisDeEncerrado({ acao: 'reabrir', id: 'c1' })).toBe(true);
  });

  it('conversa nova depois de uma encerrada também conta — base antiga tem histórico partido', () => {
    expect(voltandoDepoisDeEncerrado({ acao: 'criar' }, 'closed')).toBe(true);
  });

  it('contato novo de verdade não é retorno', () => {
    expect(voltandoDepoisDeEncerrado({ acao: 'criar' }, null)).toBe(false);
  });

  it('mensagem em atendimento aberto não é retorno', () => {
    expect(voltandoDepoisDeEncerrado({ acao: 'usar', id: 'c1' }, 'closed')).toBe(false);
  });
});
