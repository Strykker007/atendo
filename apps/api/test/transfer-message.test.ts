import { describe, expect, it } from 'vitest';
import { buildTransferMessage, DEFAULT_DEPARTMENT_TRANSFER_TEXT, DEFAULT_TRANSFER_TEXT } from '../src/modules/conversations/transfer-message';

describe('buildTransferMessage', () => {
  it('usa o primeiro nome de quem recebeu', () => {
    expect(buildTransferMessage('Você foi transferido para {{atendente}}', { agentName: 'Maria  Silva' })).toBe('Você foi transferido para Maria');
    expect(buildTransferMessage('Agora com {{ nome }}.', { agentName: 'João' })).toBe('Agora com João.');
  });
  it('departamento', () => {
    expect(buildTransferMessage(DEFAULT_DEPARTMENT_TRANSFER_TEXT, { departmentName: 'Financeiro' })).toContain('setor Financeiro.');
  });
  it('variável sem valor ou texto vazio: não manda nada', () => {
    expect(buildTransferMessage(DEFAULT_TRANSFER_TEXT, { departmentName: 'Financeiro' })).toBeNull();
    expect(buildTransferMessage('  ', { agentName: 'Ana' })).toBeNull();
    expect(buildTransferMessage(null, { agentName: 'Ana' })).toBeNull();
  });
  it('texto sem variável sai como está', () => {
    expect(buildTransferMessage('Um momento, por favor.', {})).toBe('Um momento, por favor.');
  });
});
