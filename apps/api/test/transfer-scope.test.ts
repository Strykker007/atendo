import { describe, expect, it } from 'vitest';
import { canReceiveTransfer, type TransferTargetScope } from '../src/modules/conversations/transfer-scope';

const companyNumbers = new Map([
  ['matriz', ['n1', 'n2']],
  ['filial', ['n3']],
]);
const conv = { numberId: 'n3', departmentId: null };
const user = (o: Partial<TransferTargetScope> = {}): TransferTargetScope => ({ role: 'agent', permissions: [], numberIds: [], companyIds: [], departmentIds: [], ...o });

describe('canReceiveTransfer', () => {
  it('"todos os números" e sem empresa: recebe de qualquer filial (apoio)', () => {
    expect(canReceiveTransfer(user(), conv, companyNumbers)).toBe(true);
  });

  it('usuário de outra empresa não recebe', () => {
    expect(canReceiveTransfer(user({ companyIds: ['matriz'] }), conv, companyNumbers)).toBe(false);
  });

  it('usuário da mesma empresa recebe', () => {
    expect(canReceiveTransfer(user({ companyIds: ['filial'] }), conv, companyNumbers)).toBe(true);
  });

  it('vinculado às duas empresas recebe de ambas', () => {
    expect(canReceiveTransfer(user({ companyIds: ['matriz', 'filial'] }), conv, companyNumbers)).toBe(true);
  });

  it('número específico: só recebe se for o da conversa', () => {
    expect(canReceiveTransfer(user({ numberIds: ['n1'] }), conv, companyNumbers)).toBe(false);
    expect(canReceiveTransfer(user({ numberIds: ['n3'] }), conv, companyNumbers)).toBe(true);
  });

  it('cliente sem empresas: vale só o vínculo com números', () => {
    expect(canReceiveTransfer(user(), conv, new Map())).toBe(true);
    expect(canReceiveTransfer(user({ numberIds: ['n1'] }), conv, new Map())).toBe(false);
  });

  it('departamento restrito: não recebe conversa de outro departamento', () => {
    expect(canReceiveTransfer(user({ departmentIds: ['vendas'] }), { numberId: 'n3', departmentId: 'suporte' }, companyNumbers)).toBe(false);
    expect(canReceiveTransfer(user({ departmentIds: ['vendas'], permissions: ['conversations.view_all'] }), { numberId: 'n3', departmentId: 'suporte' }, companyNumbers)).toBe(true);
  });
});
